// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IEscrow } from "./IEscrow.sol";
import { IBaseEscrow } from "./IBaseEscrow.sol";

interface IEscrowDst is IEscrow {
    function publicWithdraw(bytes32 secret, IBaseEscrow.ExecutionData calldata executionData) external;
}