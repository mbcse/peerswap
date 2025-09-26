// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { Clones } from "openzeppelin-contracts/contracts/proxy/Clones.sol";
import { IERC20 } from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "solidity-utils/contracts/libraries/SafeERC20.sol";

import { IBaseEscrow } from "./interfaces/IBaseEscrow.sol";
import { IEscrowFactory } from "./interfaces/IEscrowFactory.sol";
import { IEscrowSrc } from "./interfaces/IEscrowSrc.sol";
import { IEscrowDst } from "./interfaces/IEscrowDst.sol";
import { EscrowSrc } from "./EscrowSrc.sol";
import { EscrowDst } from "./EscrowDst.sol";

contract EscrowFactory is IEscrowFactory {
    using SafeERC20 for IERC20;

    /// @notice Default platform fee in basis points (1% = 100)
    uint256 public constant DEFAULT_PLATFORM_FEE = 100;
    
    /// @notice Maximum platform fee in basis points (10% = 1000)
    uint256 public constant MAX_PLATFORM_FEE = 1000;
    
    /// @notice Platform fee in basis points
    uint256 public platformFee;
    
    /// @notice Address to collect platform fees
    address public feeCollector;
    
    /// @notice EscrowSrc implementation contract
    address public immutable escrowSrcImpl;
    
    /// @notice EscrowDst implementation contract
    address public immutable escrowDstImpl;
    
    /// @notice Rescue delay for escrows
    uint32 public immutable rescueDelay;
    
    /// @notice Access token for public functions
    IERC20 public immutable accessToken;

    /// @notice Relayer address that can set fulfiller
    address public relayer;

    event PlatformFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeCollectorUpdated(address oldCollector, address newCollector);
    event PlatformFeeCollected(address indexed token, uint256 amount, address indexed collector);
    event RelayerUpdated(address oldRelayer, address newRelayer);
    event FulfillerSet(address indexed srcEscrowAddress, address indexed fulfiller);

    error InvalidFee();
    error InvalidFeeCollector();
    error InsufficientGasFee();
    error InvalidExecutionData();
    error InvalidRelayer();
    error OnlyRelayer();

    modifier onlyOwner() {
        require(msg.sender == feeCollector, "Only fee collector can call this");
        _;
    }

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert OnlyRelayer();
        _;
    }

    constructor(
        address _escrowSrcImpl,
        address _escrowDstImpl,
        uint32 _rescueDelay,
        IERC20 _accessToken,
        address _feeCollector,
        address _relayer
    ) {
        require(_escrowSrcImpl != address(0), "Invalid escrow src impl");
        require(_escrowDstImpl != address(0), "Invalid escrow dst impl");
        require(_feeCollector != address(0), "Invalid fee collector");
        require(_relayer != address(0), "Invalid relayer");

        escrowSrcImpl = _escrowSrcImpl;
        escrowDstImpl = _escrowDstImpl;
        rescueDelay = _rescueDelay;
        accessToken = _accessToken;
        feeCollector = _feeCollector;
        relayer = _relayer;
        platformFee = DEFAULT_PLATFORM_FEE;
    }

    /// @notice Update platform fee
    function setPlatformFee(uint256 newFee) external onlyOwner {
        if (newFee > MAX_PLATFORM_FEE) revert InvalidFee();
        uint256 oldFee = platformFee;
        platformFee = newFee;
        emit PlatformFeeUpdated(oldFee, newFee);
    }

    /// @notice Update fee collector
    function setFeeCollector(address newCollector) external onlyOwner {
        if (newCollector == address(0)) revert InvalidFeeCollector();
        address oldCollector = feeCollector;
        feeCollector = newCollector;
        emit FeeCollectorUpdated(oldCollector, newCollector);
    }

    /// @notice Update relayer address
    function setRelayer(address newRelayer) external onlyOwner {
        if (newRelayer == address(0)) revert InvalidRelayer();
        address oldRelayer = relayer;
        relayer = newRelayer;
        emit RelayerUpdated(oldRelayer, newRelayer);
    }

    /// @notice Create source escrow (called by asker)
    function createSrcEscrow(IBaseEscrow.ExecutionData calldata executionData)
        external
        payable
    {
        // Validate execution data
        if (executionData.asker == address(0)) {
            revert InvalidExecutionData();
        }
        if (executionData.askerAmount == 0) {
            revert InvalidExecutionData();
        }
        if (executionData.platformFee > MAX_PLATFORM_FEE) {
            revert InvalidFee();
        }
        // For native ETH (srcToken == address(0)), ensure sufficient ETH sent
        if (executionData.srcToken == address(0) && msg.value < executionData.askerAmount) {
            revert InvalidExecutionData();
        }

        // Only the asker can create their source escrow
        require(msg.sender == executionData.asker, "Only asker can create source escrow");
        
        // For ETH swaps, msg.value contains both gas fee and token amount
        // For ERC-20 swaps, msg.value is just the gas fee
        // The escrow will handle the split internally
        
        // Deploy source escrow using deterministic address
        bytes32 salt = keccak256(abi.encode(executionData));
        address escrowSrc = Clones.cloneDeterministic(escrowSrcImpl, salt);
        
        // Initialize the escrow with execution data
        EscrowSrc(escrowSrc).initialize{value: msg.value}(executionData, msg.value);
        
        emit SrcEscrowCreated(executionData);
    }

    /// @notice Create destination escrow (called by fulfiller)
    function createDstEscrow(IBaseEscrow.ExecutionData calldata executionData)
        external
        payable
    {
        // Validate execution data
        if (executionData.asker == address(0) || executionData.fullfiller == address(0)) {
            revert InvalidExecutionData();
        }
        if (executionData.fullfillerAmount == 0) {
            revert InvalidExecutionData();
        }
        // For native ETH (dstToken == address(0)), ensure sufficient ETH sent
        if (executionData.dstToken == address(0) && msg.value < executionData.fullfillerAmount) {
            revert InvalidExecutionData();
        }
        
        // For ETH swaps, msg.value contains both gas fee and token amount
        // For ERC-20 swaps, msg.value is just the gas fee
        // The escrow will handle the split internally
        
        // Deploy destination escrow using deterministic address
        bytes32 salt = keccak256(abi.encode(executionData));
        address escrowDst = Clones.cloneDeterministic(escrowDstImpl, salt);
        
        // Initialize the escrow with execution data
        EscrowDst(escrowDst).initialize{value: msg.value}(
            executionData,
            rescueDelay,
            accessToken,
            msg.value
        );
        
        emit DstEscrowCreated(escrowDst, executionData.hashlock, executionData.asker);
    }

    /// @notice Get the address of source escrow
    function addressOfEscrowSrc(IBaseEscrow.ExecutionData calldata executionData) 
        external 
        view 
        returns (address) 
    {
        bytes32 salt = keccak256(abi.encode(executionData));
        return Clones.predictDeterministicAddress(escrowSrcImpl, salt, address(this));
    }

    /// @notice Get the address of destination escrow
    function addressOfEscrowDst(IBaseEscrow.ExecutionData calldata executionData)
        external
        view
        returns (address)
    {
        bytes32 salt = keccak256(abi.encode(executionData));
        return Clones.predictDeterministicAddress(escrowDstImpl, salt, address(this));
    }

    /// @notice Set fulfiller address on source escrow (called by relayer)
    function setFulfiller(address srcEscrowAddress, address fulfillerAddress)
        external
        onlyRelayer
    {
        require(srcEscrowAddress != address(0), "Invalid src escrow address");
        require(fulfillerAddress != address(0), "Invalid fulfiller address");

        // Call setFulfiller on the source escrow contract
        IEscrowSrc(srcEscrowAddress).setFulfiller(fulfillerAddress);

        emit FulfillerSet(srcEscrowAddress, fulfillerAddress);
    }

    /// @notice Collect platform fees
    function collectPlatformFees(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance > 0) {
            IERC20(token).safeTransfer(feeCollector, balance);
            emit PlatformFeeCollected(token, balance, feeCollector);
        }
    }

    /// @notice Collect native platform fees
    function collectNativePlatformFees() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool success, ) = feeCollector.call{value: balance}("");
            require(success, "Transfer failed");
            emit PlatformFeeCollected(address(0), balance, feeCollector);
        }
    }

    /// @notice Emergency function to recover stuck tokens
    function emergencyRecover(address token, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            (bool success, ) = feeCollector.call{value: amount}("");
            require(success, "Transfer failed");
        } else {
            IERC20(token).safeTransfer(feeCollector, amount);
        }
    }
}
