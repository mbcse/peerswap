// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

library ProxyHashLib {
    /// @notice Computes the bytecode hash for a proxy contract
    /// @param proxyBytecode The proxy contract bytecode
    /// @return The computed hash
    function computeProxyHash(bytes memory proxyBytecode) internal pure returns (bytes32) {
        return keccak256(proxyBytecode);
    }
    
    /// @notice Computes the creation code hash for a contract
    /// @param creationCode The contract creation code
    /// @return The computed hash
    function computeCreationCodeHash(bytes memory creationCode) internal pure returns (bytes32) {
        return keccak256(creationCode);
    }
}