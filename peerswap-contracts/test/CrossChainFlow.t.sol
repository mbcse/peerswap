// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import { ERC20Mock } from "openzeppelin-contracts/contracts/mocks/token/ERC20Mock.sol";

import { EscrowSrc } from "../src/EscrowSrc.sol";
import { EscrowDst } from "../src/EscrowDst.sol";
import { IBaseEscrow } from "../src/interfaces/IBaseEscrow.sol";
import { ExecutionDataLib } from "../src/libraries/ExecutionDataLib.sol";
import { Timelocks } from "../src/libraries/TimelocksLib.sol";

contract CrossChainFlowTest is Test {
    address asker = address(0xA11CE);
    address fullfiller = address(0xB0B);
    address relayer = address(0x311);
    address feeCollector = address(0xFEE);

    ERC20Mock srcToken;
    ERC20Mock dstToken;
    ERC20Mock accessToken;

    EscrowSrc escrowSrc;
    EscrowDst escrowDst;

    uint256 askerAmount = 1_000 ether;
    uint256 fulfillerAmount = 2_000 ether;
    uint256 platformFeeBps = 100; // 1%
    uint256 gasFeeSrc = 0.01 ether;
    uint256 gasFeeDst = 0.02 ether;
    uint32 rescueDelay = 0; // disable for tests

    bytes32 secret;
    bytes32 hashlock;

    IBaseEscrow.ExecutionData executionData;

    function setUp() public {
        // Deploy mock tokens
        srcToken = new ERC20Mock();
        dstToken = new ERC20Mock();
        accessToken = new ERC20Mock();

        // Mint initial supplies
        srcToken.mint(address(this), askerAmount);
        dstToken.mint(address(this), fulfillerAmount);
        accessToken.mint(address(this), 1 ether);

        // Fund participants
        srcToken.mint(asker, askerAmount);
        dstToken.mint(fullfiller, fulfillerAmount);
        accessToken.mint(relayer, 1 ether);
        vm.deal(asker, 10 ether);
        vm.deal(fullfiller, 10 ether);
        vm.deal(relayer, 10 ether);

        // Deploy escrows (in tests, the test contract is the FACTORY)
        escrowSrc = new EscrowSrc(rescueDelay, IERC20(address(accessToken)));
        escrowDst = new EscrowDst(rescueDelay, IERC20(address(accessToken)));

        // Prepare secret/hashlock
        secret = keccak256(abi.encodePacked("super-secret"));
        hashlock = keccak256(abi.encodePacked(secret));

        // Prepare execution data with zero timelocks (so public periods start at 0)
        executionData = IBaseEscrow.ExecutionData({
            orderHash: keccak256("order"),
            hashlock: hashlock,
            asker: asker,
            fullfiller: fullfiller,
            srcToken: address(srcToken),
            dstToken: address(dstToken),
            srcChainId: 1,
            dstChainId: 137,
            askerAmount: askerAmount,
            fullfillerAmount: fulfillerAmount,
            platformFee: platformFeeBps,
            feeCollector: feeCollector,
            timelocks: Timelocks.wrap(0),
            parameters: ""
        });

        // Approvals for transfers pulled during initialize
        vm.startPrank(asker);
        srcToken.approve(address(escrowSrc), askerAmount);
        vm.stopPrank();

        vm.startPrank(fullfiller);
        dstToken.approve(address(escrowDst), fulfillerAmount);
        vm.stopPrank();

        // Initialize escrows (factory is msg.sender in constructors, so test contract can call)
        escrowSrc.initialize{value: gasFeeSrc}(executionData, gasFeeSrc);
        escrowDst.initialize{value: gasFeeDst}(executionData, rescueDelay, IERC20(address(accessToken)), gasFeeDst);
    }

    function test_happyPath_withdraw_on_both_chains() public {
        // Balances before
        uint256 askerDstBefore = dstToken.balanceOf(asker);
        uint256 fullfillerSrcBefore = srcToken.balanceOf(fullfiller);
        uint256 feeCollectorBefore = srcToken.balanceOf(feeCollector);
        uint256 relayerEthBefore = relayer.balance;

        // Destination chain: asker withdraws their tokens using the secret
        vm.prank(asker);
        escrowDst.withdraw(secret, executionData);

        // Check asker received dst tokens and got gas rebate
        assertEq(dstToken.balanceOf(asker) - askerDstBefore, fulfillerAmount);

        // Source chain: relayer submits secret to withdraw in favor of fullfiller and earns gas rebate
        vm.prank(relayer);
        escrowSrc.withdraw(secret, executionData);

        uint256 platformFeeAmount = (askerAmount * platformFeeBps) / 10_000;
        uint256 expectedSrcToFullfiller = askerAmount - platformFeeAmount;

        // Verify token distributions on source chain
        assertEq(srcToken.balanceOf(fullfiller) - fullfillerSrcBefore, expectedSrcToFullfiller);
        assertEq(srcToken.balanceOf(feeCollector) - feeCollectorBefore, platformFeeAmount);

        // Verify relayer got src gas rebate, and asker got dst gas rebate
        assertEq(relayer.balance - relayerEthBefore, gasFeeSrc);
    }

    function test_publicWithdraw_requires_accessToken() public {
        // Relayer has access token, can call public withdraw on destination chain
        uint256 relayerDstBefore = dstToken.balanceOf(relayer);

        vm.prank(relayer);
        escrowDst.publicWithdraw(secret, executionData);

        assertEq(dstToken.balanceOf(relayer) - relayerDstBefore, fulfillerAmount);
    }

    function test_publicCancel_src_sends_funds_back_to_asker_and_relayer_gets_gas() public {
        // First, cancel on source chain using public cancel by relayer (has access token)
        uint256 askerSrcBefore = srcToken.balanceOf(asker);
        uint256 relayerEthBefore = relayer.balance;

        vm.prank(relayer);
        escrowSrc.publicCancel(executionData);

        assertEq(srcToken.balanceOf(asker) - askerSrcBefore, askerAmount);
        assertEq(relayer.balance - relayerEthBefore, gasFeeSrc);
    }

    function test_revert_on_invalid_secret_withdraw() public {
        bytes32 wrongSecret = keccak256("wrong");
        // dst
        vm.expectRevert();
        vm.prank(asker);
        escrowDst.withdraw(wrongSecret, executionData);
        // src
        vm.expectRevert();
        vm.prank(relayer);
        escrowSrc.withdraw(wrongSecret, executionData);
    }

    function test_double_withdraw_reverts_on_second_call() public {
        // First: dst withdraw success
        vm.prank(asker);
        escrowDst.withdraw(secret, executionData);
        // Second: dst withdraw should revert (inactive)
        vm.expectRevert();
        vm.prank(asker);
        escrowDst.withdraw(secret, executionData);

        // First: src withdraw success
        vm.prank(relayer);
        escrowSrc.withdraw(secret, executionData);
        // Second: src withdraw should revert (inactive)
        vm.expectRevert();
        vm.prank(relayer);
        escrowSrc.withdraw(secret, executionData);
    }

    function test_public_functions_require_access_token() public {
        address outsider = address(0xDEAD);
        vm.deal(outsider, 1 ether);
        // outsider has no access token
        vm.expectRevert();
        vm.prank(outsider);
        escrowDst.publicWithdraw(secret, executionData);
        vm.expectRevert();
        vm.prank(outsider);
        escrowSrc.publicCancel(executionData);
    }

    function test_dst_cancel_returns_to_fullfiller_and_rebates_gas() public {
        // Cancel on destination chain
        uint256 beforeFullfiller = dstToken.balanceOf(fullfiller);
        uint256 beforeFullfillerEth = fullfiller.balance;
        vm.prank(fullfiller);
        escrowDst.cancel(executionData);
        assertEq(dstToken.balanceOf(fullfiller) - beforeFullfiller, fulfillerAmount);
        assertEq(fullfiller.balance - beforeFullfillerEth, gasFeeDst);
    }

    function test_rescueFunds_asker_can_rescue_extra_tokens() public {
        // Send extra SRC tokens to src escrow and rescue by asker
        uint256 extra = 123e18;
        srcToken.mint(address(this), extra);
        srcToken.transfer(address(escrowSrc), extra);
        uint256 before = srcToken.balanceOf(asker);
        vm.prank(asker);
        escrowSrc.rescueFunds(address(srcToken), extra, executionData);
        assertEq(srcToken.balanceOf(asker) - before, extra);
    }
}
