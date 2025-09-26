// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IERC20 } from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "solidity-utils/contracts/libraries/SafeERC20.sol";

import { BaseEscrow } from "./BaseEscrow.sol";
import { IBaseEscrow } from "./interfaces/IBaseEscrow.sol";
import { IEscrowSrc } from "./interfaces/IEscrowSrc.sol";
import { ExecutionDataLib } from "./libraries/ExecutionDataLib.sol";
import { Timelocks, TimelocksLib } from "./libraries/TimelocksLib.sol";

contract EscrowSrc is BaseEscrow, IEscrowSrc {
    using SafeERC20 for IERC20;
    using ExecutionDataLib for ExecutionData;
    using TimelocksLib for Timelocks;

    /// @notice Execution data for this escrow
    ExecutionData public executionData;
    
    /// @notice Whether the escrow is active
    bool public override isActive;
    
    /// @notice Gas fee that will be returned to the caller who withdraws
    uint256 public gasFee;
    
    /// @notice Platform fee amount
    uint256 public platformFeeAmount;

    event SrcEscrowInitialized(address indexed asker, address indexed srcToken, uint256 amount);
    event SrcTokensWithdrawn(address indexed token, uint256 amount, address indexed recipient);
    event SrcEscrowCancelled(address indexed token, uint256 amount, address indexed recipient);
    event FulfillerUpdated(address indexed oldFulfiller, address indexed newFulfiller);

    error EscrowAlreadyInitialized();
    error EscrowNotInitialized();
    error InsufficientTokenBalance();
    error InvalidWithdrawalAmount();
    error OnlyFactory();

    modifier onlyActive() {
        if (!isActive) revert EscrowNotActive();
        _;
    }

    modifier onlyInactive() {
        if (isActive) revert EscrowAlreadyInitialized();
        _;
    }

    modifier onlyFactory() {
        if (msg.sender != FACTORY) revert OnlyFactory();
        _;
    }

    constructor(uint32 rescueDelay, IERC20 accessToken) BaseEscrow(rescueDelay, accessToken) {}

    /// @notice Initialize the escrow with execution data
    function initialize(
        IBaseEscrow.ExecutionData calldata _executionData,
        uint256 _gasFee
    ) external payable onlyInactive {
        // Set factory address on first initialization
        if (FACTORY == address(0)) {
            FACTORY = msg.sender;
        }
        require(msg.sender == FACTORY, "Only factory can initialize");
        executionData = _executionData;
        isActive = true;
        
        // Calculate platform fee
        platformFeeAmount = (executionData.askerAmount * executionData.platformFee) / 10000;
        
        // Handle token transfer and gas fee based on token type
        if (executionData.srcToken == address(0)) {
            // Native ETH - msg.value should contain both gas fee and token amount
            require(msg.value >= executionData.askerAmount, "Insufficient ETH sent");
            // Safe gas fee calculation - prevent underflow
            unchecked {
                gasFee = msg.value - executionData.askerAmount;
            }
        } else {
            // ERC-20 token - msg.value is just the gas fee (be more flexible)
            gasFee = msg.value; // Accept any gas fee amount
            IERC20(executionData.srcToken).safeTransferFrom(
                executionData.asker,
                address(this),
                executionData.askerAmount
            );
        }
        
        emit SrcEscrowInitialized(executionData.asker, executionData.srcToken, executionData.askerAmount);
    }

    /// @notice Set fulfiller address (called by factory)
    function setFulfiller(address newFulfiller) external onlyFactory onlyActive {
        require(newFulfiller != address(0), "Invalid fulfiller address");

        address oldFulfiller = executionData.fullfiller;
        executionData.fullfiller = newFulfiller;

        emit FulfillerUpdated(oldFulfiller, newFulfiller);
    }

    /// @notice Withdraw tokens using secret (called by asker or fullfiller)
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

        // Calculate amounts
        uint256 withdrawAmount = executionData.askerAmount - platformFeeAmount;

        // Transfer tokens to fullfiller
        if (executionData.srcToken == address(0)) {
            // Native ETH transfer with gas limit
            (bool success, ) = executionData.fullfiller.call{value: withdrawAmount, gas: 2300}("");
            require(success, "ETH transfer failed");

            // Transfer platform fee
            if (platformFeeAmount > 0) {
                (bool feeSuccess, ) = executionData.feeCollector.call{value: platformFeeAmount, gas: 2300}("");
                require(feeSuccess, "Fee transfer failed");
            }
        } else {
            // ERC-20 transfer
            IERC20(executionData.srcToken).safeTransfer(executionData.fullfiller, withdrawAmount);

            // Transfer platform fee
            if (platformFeeAmount > 0) {
                IERC20(executionData.srcToken).safeTransfer(executionData.feeCollector, platformFeeAmount);
            }
        }

        // Return gas fee to caller
        if (gasFee > 0) {
            (bool success, ) = msg.sender.call{value: gasFee, gas: 2300}("");
            require(success, "Gas fee transfer failed");
        }

        emit SrcTokensWithdrawn(executionData.srcToken, withdrawAmount, executionData.fullfiller);
        if (platformFeeAmount > 0) {
            emit SrcTokensWithdrawn(executionData.srcToken, platformFeeAmount, executionData.feeCollector);
        }
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
            block.timestamp >= executionData.timelocks.get(TimelocksLib.Stage.SrcPublicWithdrawal),
            "Public withdrawal not yet available"
        );
        
        // Transfer tokens to caller
        uint256 withdrawAmount = executionData.askerAmount - platformFeeAmount;
        if (executionData.srcToken == address(0)) {
            // Native ETH transfer
            (bool success, ) = msg.sender.call{value: withdrawAmount}("");
            require(success, "ETH transfer failed");
            
            // Transfer platform fee
            if (platformFeeAmount > 0) {
                (bool feeSuccess, ) = executionData.feeCollector.call{value: platformFeeAmount}("");
                require(feeSuccess, "Fee transfer failed");
            }
        } else {
            // ERC-20 transfer
            IERC20(executionData.srcToken).safeTransfer(msg.sender, withdrawAmount);
            
            // Transfer platform fee
            if (platformFeeAmount > 0) {
                IERC20(executionData.srcToken).safeTransfer(executionData.feeCollector, platformFeeAmount);
            }
        }
        
        // Return gas fee to caller
        if (gasFee > 0) {
            (bool success, ) = msg.sender.call{value: gasFee}("");
            require(success, "Gas fee transfer failed");
        }
        
        // Mark escrow as inactive
        isActive = false;
        
        emit SrcTokensWithdrawn(executionData.srcToken, withdrawAmount, msg.sender);
        emit SrcTokensWithdrawn(executionData.srcToken, platformFeeAmount, executionData.feeCollector);
    }

    /// @notice Cancel escrow (called by asker)
    function cancel(IBaseEscrow.ExecutionData calldata _executionData) 
        external 
        override 
        onlyActive 
        onlyAsker(_executionData.asker)
        onlyValidExecutionData(ExecutionDataLib.hash(_executionData))
    {
        require(_executionData.asker == executionData.asker, "Invalid execution data");
        
        // Check if cancellation period has started
        require(
            block.timestamp >= executionData.timelocks.get(TimelocksLib.Stage.SrcCancellation),
            "Cancellation not yet available"
        );
        
        // Return tokens to asker
        if (executionData.srcToken == address(0)) {
            // Native ETH transfer
            (bool success, ) = executionData.asker.call{value: executionData.askerAmount}("");
            require(success, "ETH transfer failed");
        } else {
            // ERC-20 transfer
            IERC20(executionData.srcToken).safeTransfer(executionData.asker, executionData.askerAmount);
        }
        
        // Return gas fee to asker
        if (gasFee > 0) {
            (bool success, ) = executionData.asker.call{value: gasFee}("");
            require(success, "Gas fee transfer failed");
        }
        
        // Mark escrow as inactive
        isActive = false;
        
        emit SrcEscrowCancelled(executionData.srcToken, executionData.askerAmount, executionData.asker);
    }

    /// @notice Public cancel during public cancellation period
    function publicCancel(IBaseEscrow.ExecutionData calldata _executionData) 
        external 
        override 
        onlyActive 
        onlyValidExecutionData(ExecutionDataLib.hash(_executionData))
        onlyAccessTokenHolder()
    {
        require(_executionData.asker == executionData.asker, "Invalid execution data");
        
        // Check if public cancellation period has started
        require(
            block.timestamp >= executionData.timelocks.get(TimelocksLib.Stage.SrcPublicCancellation),
            "Public cancellation not yet available"
        );
        
        // Return tokens to asker
        if (executionData.srcToken == address(0)) {
            // Native ETH transfer
            (bool success, ) = executionData.asker.call{value: executionData.askerAmount}("");
            require(success, "ETH transfer failed");
        } else {
            // ERC-20 transfer
            IERC20(executionData.srcToken).safeTransfer(executionData.asker, executionData.askerAmount);
        }
        
        // Return gas fee to caller
        if (gasFee > 0) {
            (bool success, ) = msg.sender.call{value: gasFee}("");
            require(success, "Gas fee transfer failed");
        }
        
        // Mark escrow as inactive
        isActive = false;
        
        emit SrcEscrowCancelled(executionData.srcToken, executionData.askerAmount, executionData.asker);
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
