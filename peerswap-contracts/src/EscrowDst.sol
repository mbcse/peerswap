// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IERC20 } from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "solidity-utils/contracts/libraries/SafeERC20.sol";

import { BaseEscrow } from "./BaseEscrow.sol";
import { IBaseEscrow } from "./interfaces/IBaseEscrow.sol";
import { IEscrowDst } from "./interfaces/IEscrowDst.sol";
import { ExecutionDataLib } from "./libraries/ExecutionDataLib.sol";
import { Timelocks, TimelocksLib } from "./libraries/TimelocksLib.sol";

contract EscrowDst is BaseEscrow, IEscrowDst {
    using SafeERC20 for IERC20;
    using ExecutionDataLib for ExecutionData;
    using TimelocksLib for Timelocks;

    /// @notice Execution data for this escrow
    ExecutionData public executionData;
    
    /// @notice Whether the escrow is active
    bool public override isActive;
    
    /// @notice Gas fee that will be returned to the caller who withdraws
    uint256 public gasFee;

    event DstEscrowInitialized(address indexed fullfiller, address indexed dstToken, uint256 amount);
    event DstTokensWithdrawn(address indexed token, uint256 amount, address indexed recipient);
    event DstEscrowCancelled(address indexed token, uint256 amount, address indexed recipient);
    event DstSecretRevealed(bytes32 secret, bytes32 hashlock);

    error EscrowAlreadyInitialized();
    error EscrowNotInitialized();
    error InsufficientTokenBalance();
    error InvalidWithdrawalAmount();

    modifier onlyActive() {
        if (!isActive) revert EscrowNotActive();
        _;
    }

    modifier onlyInactive() {
        if (isActive) revert EscrowAlreadyInitialized();
        _;
    }

    constructor(uint32 rescueDelay, IERC20 accessToken) BaseEscrow(rescueDelay, accessToken) {}

    /// @notice Initialize the escrow with execution data
    function initialize(
        IBaseEscrow.ExecutionData calldata _executionData,
        uint32 _rescueDelay,
        IERC20 _accessToken,
        uint256 _gasFee
    ) external payable onlyInactive {
        // Set factory address on first initialization
        if (FACTORY == address(0)) {
            FACTORY = msg.sender;
        }
        require(msg.sender == FACTORY, "Only factory can initialize");
        executionData = _executionData;
        isActive = true;
        
        // Handle token transfer and gas fee based on token type
        if (_executionData.dstToken == address(0)) {
            // Native ETH - msg.value should contain both gas fee and token amount
            require(msg.value >= _executionData.fullfillerAmount, "Insufficient ETH sent");
            // Safe gas fee calculation - prevent underflow
            unchecked {
                gasFee = msg.value - _executionData.fullfillerAmount;
            }
        } else {
            // ERC-20 token - msg.value is just the gas fee (be more flexible)
            gasFee = msg.value; // Accept any gas fee amount
            IERC20(_executionData.dstToken).safeTransferFrom(
                _executionData.fullfiller,
                address(this),
                _executionData.fullfillerAmount
            );
        }
        
        emit DstEscrowInitialized(_executionData.fullfiller, _executionData.dstToken, _executionData.fullfillerAmount);
    }

    /// @notice Withdraw tokens using secret (called by asker)
    function withdraw(bytes32 secret, IBaseEscrow.ExecutionData calldata _executionData)
        external
        override
        onlyActive
        onlyValidSecret(secret, _executionData.hashlock)
        onlyValidExecutionData(ExecutionDataLib.hash(_executionData))
    {
        require(_executionData.asker == executionData.asker, "Invalid execution data");

        // Mark escrow as inactive FIRST (reentrancy protection)
        isActive = false;

        // Emit secret revealed event
        emit DstSecretRevealed(secret, executionData.hashlock);

        // Transfer tokens to asker
        if (executionData.dstToken == address(0)) {
            // Native ETH transfer with gas limit
            (bool success, ) = executionData.asker.call{value: executionData.fullfillerAmount, gas: 2300}("");
            require(success, "ETH transfer failed");
        } else {
            // ERC-20 transfer
            IERC20(executionData.dstToken).safeTransfer(executionData.asker, executionData.fullfillerAmount);
        }

        // Return gas fee to caller
        if (gasFee > 0) {
            (bool success, ) = msg.sender.call{value: gasFee, gas: 2300}("");
            require(success, "Gas fee transfer failed");
        }

        emit DstTokensWithdrawn(executionData.dstToken, executionData.fullfillerAmount, executionData.asker);
    }

    /// @notice Public withdraw during public withdrawal period
    function publicWithdraw(bytes32 secret, IBaseEscrow.ExecutionData calldata _executionData) 
        external 
        override 
        onlyActive 
        onlyValidSecret(secret, _executionData.hashlock)
        onlyValidExecutionData(ExecutionDataLib.hash(_executionData))
        onlyAccessTokenHolder()
    {
        require(_executionData.asker == executionData.asker, "Invalid execution data");
        
        // Check if public withdrawal period has started
        require(
            block.timestamp >= executionData.timelocks.get(TimelocksLib.Stage.DstPublicWithdrawal),
            "Public withdrawal not yet available"
        );
        
        // Transfer tokens to caller
        if (executionData.dstToken == address(0)) {
            // Native ETH transfer
            (bool success, ) = msg.sender.call{value: executionData.fullfillerAmount}("");
            require(success, "ETH transfer failed");
        } else {
            // ERC-20 transfer
            IERC20(executionData.dstToken).safeTransfer(msg.sender, executionData.fullfillerAmount);
        }
        emit DstSecretRevealed(secret, executionData.hashlock);
        
        // Return gas fee to caller
        if (gasFee > 0) {
            (bool success, ) = msg.sender.call{value: gasFee}("");
            require(success, "Gas fee transfer failed");
        }
        
        // Mark escrow as inactive
        isActive = false;
        
        emit DstTokensWithdrawn(executionData.dstToken, executionData.fullfillerAmount, msg.sender);
        emit DstSecretRevealed(secret, _executionData.hashlock);
    }

    /// @notice Cancel escrow (called by fullfiller)
    function cancel(IBaseEscrow.ExecutionData calldata _executionData) 
        external 
        override 
        onlyActive 
        onlyValidExecutionData(ExecutionDataLib.hash(_executionData))
    {
        require(_executionData.fullfiller == executionData.fullfiller, "Invalid execution data");
        
        // Check if cancellation period has started
        require(
            block.timestamp >= executionData.timelocks.get(TimelocksLib.Stage.DstCancellation),
            "Cancellation not yet available"
        );
        
        // Return tokens to fullfiller
        if (executionData.dstToken == address(0)) {
            // Native ETH transfer
            (bool success, ) = executionData.fullfiller.call{value: executionData.fullfillerAmount}("");
            require(success, "ETH transfer failed");
        } else {
            // ERC-20 transfer
            IERC20(executionData.dstToken).safeTransfer(executionData.fullfiller, executionData.fullfillerAmount);
        }
        
        // Return gas fee to fullfiller
        if (gasFee > 0) {
            (bool success, ) = executionData.fullfiller.call{value: gasFee}("");
            require(success, "Gas fee transfer failed");
        }
        
        // Mark escrow as inactive
        isActive = false;
        
        emit DstEscrowCancelled(executionData.dstToken, executionData.fullfillerAmount, executionData.fullfiller);
    }

    /// @notice Get immutables hash for validation
    function getImmutablesHash() external view override returns (bytes32) {
        return ExecutionDataLib.hashMem(executionData);
    }

    /// @notice Validate execution data
    function _validateExecutionData(bytes32 executionDataHash) internal view override {
        if (executionDataHash != ExecutionDataLib.hashMem(executionData)) revert InvalidExecutionData();
    }

    /// @notice Get proxy bytecode hash
    function PROXY_BYTECODE_HASH() external view override returns (bytes32) {
        // Get the contract's runtime code and compute its hash
        bytes memory runtimeCode = new bytes(0);
        assembly {
            // Get the size of the runtime code
            let size := extcodesize(address())
            // Create a new bytes array with the runtime code size
            runtimeCode := mload(0x40)
            mstore(runtimeCode, size)
            // Copy the runtime code to the bytes array
            extcodecopy(address(), add(runtimeCode, 0x20), 0, size)
            // Update the free memory pointer
            mstore(0x40, add(runtimeCode, add(0x20, size)))
        }
        return keccak256(runtimeCode);
    }
}
