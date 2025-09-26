// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IBaseEscrow } from "./IBaseEscrow.sol";

interface IEscrow is IBaseEscrow {
    /// @notice Returns the bytecode hash of the proxy contract.
    function PROXY_BYTECODE_HASH() external view returns (bytes32); // solhint-disable-line func-name-mixedcase
    
    /// @notice Returns the immutables hash for this escrow
    function getImmutablesHash() external view returns (bytes32);
    
    /// @notice Returns the escrow status
    function isActive() external view returns (bool);
}