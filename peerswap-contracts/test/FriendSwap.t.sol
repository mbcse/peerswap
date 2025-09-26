// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import { Timelocks, TimelocksLib } from "../src/libraries/TimelocksLib.sol";
import { IBaseEscrow } from "../src/interfaces/IBaseEscrow.sol";
import { EscrowFactory } from "../src/EscrowFactory.sol";
import { EscrowSrc } from "../src/EscrowSrc.sol";
import { EscrowDst } from "../src/EscrowDst.sol";

contract PeerSwapTest is Test {
    EscrowFactory public factory;
    EscrowSrc public escrowSrcImpl;
    EscrowDst public escrowDstImpl;
    
    address public asker = address(0x1);
    address public fullfiller = address(0x2);
    address public feeCollector = address(0x3);
    address public srcToken = address(0x4);
    address public dstToken = address(0x5);
    address public relayer = address(0x6);
    
    uint256 public constant ASKER_AMOUNT = 1000e18;
    uint256 public constant FULLFILLER_AMOUNT = 1000e18;
    uint256 public constant PLATFORM_FEE = 100; // 1%
    uint32 public constant RESCUE_DELAY = 86400; // 1 day
    
    IBaseEscrow.ExecutionData public executionData;

    function setUp() public {
        // Deploy implementation contracts
        escrowSrcImpl = new EscrowSrc(RESCUE_DELAY, IERC20(address(0)));
        escrowDstImpl = new EscrowDst(RESCUE_DELAY, IERC20(address(0)));
        
        // Deploy factory
        factory = new EscrowFactory(
            address(escrowSrcImpl),
            address(escrowDstImpl),
            RESCUE_DELAY,
            IERC20(address(0)),
            feeCollector,
            relayer
        );
        
        // Create execution data
        executionData = IBaseEscrow.ExecutionData({
            orderHash: keccak256("test order"),
            hashlock: keccak256("test hashlock"),
            asker: asker,
            fullfiller: fullfiller,
            srcToken: srcToken,
            dstToken: dstToken,
            srcChainId: 1,
            dstChainId: 137,
            askerAmount: ASKER_AMOUNT,
            fullfillerAmount: FULLFILLER_AMOUNT,
            platformFee: PLATFORM_FEE,
            feeCollector: feeCollector,
            timelocks: Timelocks.wrap(0),
            parameters: ""
        });
    }

    function testFactoryDeployment() public {
        assertEq(factory.feeCollector(), feeCollector);
        assertEq(factory.platformFee(), 100);
        assertEq(factory.escrowSrcImpl(), address(escrowSrcImpl));
        assertEq(factory.escrowDstImpl(), address(escrowDstImpl));
        assertEq(factory.rescueDelay(), RESCUE_DELAY);
    }

    function testEscrowAddresses() public {
        address srcEscrow = factory.addressOfEscrowSrc(executionData);
        address dstEscrow = factory.addressOfEscrowDst(executionData);
        
        assertTrue(srcEscrow != address(0));
        assertTrue(dstEscrow != address(0));
        assertTrue(srcEscrow != dstEscrow);
    }

    function testPlatformFeeUpdate() public {
        uint256 newFee = 200; // 2%
        
        // Impersonate the fee collector
        vm.prank(feeCollector);
        factory.setPlatformFee(newFee);
        
        assertEq(factory.platformFee(), newFee);
    }

    function testFeeCollectorUpdate() public {
        address newCollector = address(0x999);
        
        // Impersonate the fee collector
        vm.prank(feeCollector);
        factory.setFeeCollector(newCollector);
        
        assertEq(factory.feeCollector(), newCollector);
    }
}
