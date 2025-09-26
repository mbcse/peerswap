// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;


import { Timelocks } from "../libraries/TimelocksLib.sol";

import { IBaseEscrow } from "./IBaseEscrow.sol";

interface IEscrowFactory {
   

    event SrcEscrowCreated(IBaseEscrow.ExecutionData srcExecutionData);
    
    event DstEscrowCreated(address escrow, bytes32 hashlock, address asker);

    
    function createSrcEscrow(IBaseEscrow.ExecutionData calldata executionData) external payable;
    
    function createDstEscrow(IBaseEscrow.ExecutionData calldata executionData) external payable;

    function addressOfEscrowSrc(IBaseEscrow.ExecutionData calldata executionData) external view returns (address);

    function addressOfEscrowDst(IBaseEscrow.ExecutionData calldata executionData) external view returns (address);

    function setFulfiller(address srcEscrowAddress, address fulfillerAddress) external;
}