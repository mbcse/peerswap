pragma solidity ^0.8.20;

import { IBaseEscrow } from "../interfaces/IBaseEscrow.sol";

library ExecutionDataLib {
    function hash(IBaseEscrow.ExecutionData calldata executionData) internal pure returns(bytes32 ret) {
        // Compute the EIP-712 hash for the execution data
        bytes32 parametersHash = keccak256(executionData.parameters);
        
        // Create a memory copy of the execution data with the parameters field replaced by its hash
        IBaseEscrow.ExecutionData memory memData = IBaseEscrow.ExecutionData({
            orderHash: executionData.orderHash,
            hashlock: executionData.hashlock,
            asker: executionData.asker,
            fullfiller: executionData.fullfiller,
            srcToken: executionData.srcToken,
            dstToken: executionData.dstToken,
            srcChainId: executionData.srcChainId,
            dstChainId: executionData.dstChainId,
            askerAmount: executionData.askerAmount,
            fullfillerAmount: executionData.fullfillerAmount,
            platformFee: executionData.platformFee,
            feeCollector: executionData.feeCollector,
            timelocks: executionData.timelocks,
            parameters: abi.encodePacked(parametersHash)
        });
        
        // Compute the hash of the modified struct
        ret = keccak256(abi.encode(memData));
    }

    /**
     * @notice Returns the hash of the execution data.
     * @param executionData The execution data to hash.
     * @return ret The computed hash.
     */
    function hashMem(IBaseEscrow.ExecutionData memory executionData) internal pure returns(bytes32 ret) {
        // Compute the EIP-712 hash for the execution data
        bytes32 parametersHash = keccak256(executionData.parameters);
        
        // Create a temporary copy to avoid modifying the original
        IBaseEscrow.ExecutionData memory tempData = IBaseEscrow.ExecutionData({
            orderHash: executionData.orderHash,
            hashlock: executionData.hashlock,
            asker: executionData.asker,
            fullfiller: executionData.fullfiller,
            srcToken: executionData.srcToken,
            dstToken: executionData.dstToken,
            srcChainId: executionData.srcChainId,
            dstChainId: executionData.dstChainId,
            askerAmount: executionData.askerAmount,
            fullfillerAmount: executionData.fullfillerAmount,
            platformFee: executionData.platformFee,
            feeCollector: executionData.feeCollector,
            timelocks: executionData.timelocks,
            parameters: abi.encodePacked(parametersHash)
        });
        
        // Compute the hash of the modified struct
        ret = keccak256(abi.encode(tempData));
    }
}