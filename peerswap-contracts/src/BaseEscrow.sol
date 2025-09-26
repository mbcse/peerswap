// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IERC20 } from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import { AddressLib, Address } from "solidity-utils/contracts/libraries/AddressLib.sol";
import { SafeERC20 } from "solidity-utils/contracts/libraries/SafeERC20.sol";

import { ExecutionDataLib } from "./libraries/ExecutionDataLib.sol";
import { Timelocks, TimelocksLib } from "./libraries/TimelocksLib.sol";

import { IBaseEscrow } from "./interfaces/IBaseEscrow.sol";

abstract contract BaseEscrow is IBaseEscrow {
    using SafeERC20 for IERC20;
    using TimelocksLib for Timelocks;
    using ExecutionDataLib for ExecutionData;

    // Token that is used to access public withdraw or cancel functions.
    IERC20 private immutable _ACCESS_TOKEN;

    /// @notice See {IBaseEscrow-RESCUE_DELAY}.
    uint256 public immutable RESCUE_DELAY;
    /// @notice See {IBaseEscrow-FACTORY}.
    address public FACTORY;

    constructor(uint32 rescueDelay, IERC20 accessToken) {
        RESCUE_DELAY = rescueDelay;
        _ACCESS_TOKEN = accessToken;
    }

    modifier onlyAsker(address asker) {
        if (msg.sender != asker) revert InvalidCaller();
        _;
    }

    modifier onlyValidExecutionData(bytes32 executionDataHash) virtual {
        _validateExecutionData(executionDataHash);
        _;
    }

    modifier onlyValidSecret(bytes32 secret, bytes32 hashlock) {
        if (_keccakBytes32(secret) != hashlock) revert InvalidSecret();
        _;
    }

    modifier onlyAfter(uint256 start) {
        if (block.timestamp < start) revert InvalidTime();
        _;
    }

    modifier onlyBefore(uint256 stop) {
        if (block.timestamp >= stop) revert InvalidTime();
        _;
    }

    modifier onlyAccessTokenHolder() {
        if (_ACCESS_TOKEN.balanceOf(msg.sender) == 0) revert InvalidCaller();
        _;
    }

    /**
     * @notice See {IBaseEscrow-rescueFunds}.
     */
    function rescueFunds(address token, uint256 amount, ExecutionData calldata executionData)
        external
        onlyAsker(executionData.asker)
        onlyValidExecutionData(executionData.hash())
        onlyAfter(executionData.timelocks.rescueStart(RESCUE_DELAY))
    {
        _uniTransfer(token, msg.sender, amount);
        emit FundsRescued(token, amount);
    }

    /**
     * @dev Transfers ERC20 or native tokens to the recipient.
     */
    function _uniTransfer(address token, address to, uint256 amount) internal {
        if (token == address(0)) {
            _ethTransfer(to, amount);
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    /**
     * @dev Transfers native tokens to the recipient.
     * @dev Uses limited gas to prevent griefing attacks
     */
    function _ethTransfer(address to, uint256 amount) internal {
        (bool success,) = to.call{ value: amount, gas: 2300 }("");
        if (!success) revert NativeTokenSendingFailure();
    }

    /**
     * @dev Should verify that the computed escrow address matches the address of this contract.
     */
    function _validateExecutionData(bytes32 executionDataHash) internal view virtual;

    /**
     * @dev Computes the Keccak-256 hash of the secret.
     * @param secret The secret that unlocks the escrow.
     * @return ret The computed hash.
     */
    function _keccakBytes32(bytes32 secret) private pure returns (bytes32 ret) {
        assembly ("memory-safe") {
            mstore(0, secret)
            ret := keccak256(0, 0x20)
        }
    }
}