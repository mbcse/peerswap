// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import {Timelocks} from "../libraries/TimelocksLib.sol";

interface IBaseEscrow {
    struct ExecutionData {
        bytes32 orderHash;
        bytes32 hashlock;  // Hash of the secret.
        address asker;
        address fullfiller;
        address srcToken;
        address dstToken;
        uint256 srcChainId;
        uint256 dstChainId;
        uint256 askerAmount;
        uint256 fullfillerAmount;
        uint256 platformFee; // Platform fee in basis points (1% = 100)
        address feeCollector; // Address to collect platform fees
        Timelocks timelocks;
        bytes parameters;
    }

    event FundsRescued(address indexed token, uint256 amount);
    event WithdrawExecuted(address indexed token, uint256 amount, address indexed recipient);
    event EscrowCancelled(address indexed token, uint256 amount, address indexed recipient);

    error InvalidCaller();
    error InvalidSecret();
    error InvalidTime();
    error InvalidExecutionData();
    error NativeTokenSendingFailure();
    error InsufficientBalance();
    error EscrowNotActive();

    function withdraw(bytes32 secret, ExecutionData calldata executionData) external;
    function cancel(ExecutionData calldata executionData) external;
    function rescueFunds(address token, uint256 amount, ExecutionData calldata executionData) external;
}