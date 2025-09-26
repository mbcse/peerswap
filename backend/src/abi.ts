export const EscrowDstAbi = [
  {
    type: "event",
    name: "DstSecretRevealed",
    inputs: [
      { name: "secret", type: "bytes32", indexed: false },
      { name: "hashlock", type: "bytes32", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "withdraw",
    inputs: [
      { name: "secret", type: "bytes32" },
      {
        type: "tuple",
        name: "executionData",
        components: [
          { name: "orderHash", type: "bytes32" },
          { name: "hashlock", type: "bytes32" },
          { name: "asker", type: "address" },
          { name: "fullfiller", type: "address" },
          { name: "srcToken", type: "address" },
          { name: "dstToken", type: "address" },
          { name: "srcChainId", type: "uint256" },
          { name: "dstChainId", type: "uint256" },
          { name: "askerAmount", type: "uint256" },
          { name: "fullfillerAmount", type: "uint256" },
          { name: "platformFee", type: "uint256" },
          { name: "feeCollector", type: "address" },
          { name: "timelocks", type: "uint256" },
          { name: "parameters", type: "bytes" }
        ]
      }
    ],
    outputs: [],
  },
  // Error definitions
  { type: "error", name: "InvalidCaller", inputs: [] },
  { type: "error", name: "InvalidSecret", inputs: [] },
  { type: "error", name: "InvalidTime", inputs: [] },
  { type: "error", name: "InvalidExecutionData", inputs: [] },
  { type: "error", name: "NativeTokenSendingFailure", inputs: [] },
  { type: "error", name: "InsufficientBalance", inputs: [] },
  { type: "error", name: "EscrowNotActive", inputs: [] },
  { type: "error", name: "EscrowAlreadyInitialized", inputs: [] },
  { type: "error", name: "EscrowNotInitialized", inputs: [] },
  { type: "error", name: "InsufficientTokenBalance", inputs: [] },
  { type: "error", name: "InvalidWithdrawalAmount", inputs: [] },
  { type: "error", name: "OnlyFactory", inputs: [] },
  { type: "error", name: "InvalidFee", inputs: [] },
  { type: "error", name: "InvalidFeeCollector", inputs: [] },
  { type: "error", name: "InsufficientGasFee", inputs: [] },
  { type: "error", name: "InvalidRelayer", inputs: [] },
  { type: "error", name: "OnlyRelayer", inputs: [] },
];

export const ExecutionDataTuple = {
  type: "tuple",
  name: "executionData",
  components: [
    { name: "orderHash", type: "bytes32" },
    { name: "hashlock", type: "bytes32" },
    { name: "asker", type: "address" },
    { name: "fullfiller", type: "address" },
    { name: "srcToken", type: "address" },
    { name: "dstToken", type: "address" },
    { name: "srcChainId", type: "uint256" },
    { name: "dstChainId", type: "uint256" },
    { name: "askerAmount", type: "uint256" },
    { name: "fullfillerAmount", type: "uint256" },
    { name: "platformFee", type: "uint256" },
    { name: "feeCollector", type: "address" },
    { name: "timelocks", type: "uint256" },
    { name: "parameters", type: "bytes" },
  ],
} as const;

export const EscrowSrcAbi = [
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "withdraw",
    inputs: [
      { name: "secret", type: "bytes32" },
      {
        type: "tuple",
        name: "executionData",
        components: [
          { name: "orderHash", type: "bytes32" },
          { name: "hashlock", type: "bytes32" },
          { name: "asker", type: "address" },
          { name: "fullfiller", type: "address" },
          { name: "srcToken", type: "address" },
          { name: "dstToken", type: "address" },
          { name: "srcChainId", type: "uint256" },
          { name: "dstChainId", type: "uint256" },
          { name: "askerAmount", type: "uint256" },
          { name: "fullfillerAmount", type: "uint256" },
          { name: "platformFee", type: "uint256" },
          { name: "feeCollector", type: "address" },
          { name: "timelocks", type: "uint256" },
          { name: "parameters", type: "bytes" }
        ]
      }
    ],
    outputs: [],
  },
  // Error definitions
  { type: "error", name: "InvalidCaller", inputs: [] },
  { type: "error", name: "InvalidSecret", inputs: [] },
  { type: "error", name: "InvalidTime", inputs: [] },
  { type: "error", name: "InvalidExecutionData", inputs: [] },
  { type: "error", name: "NativeTokenSendingFailure", inputs: [] },
  { type: "error", name: "InsufficientBalance", inputs: [] },
  { type: "error", name: "EscrowNotActive", inputs: [] },
  { type: "error", name: "EscrowAlreadyInitialized", inputs: [] },
  { type: "error", name: "EscrowNotInitialized", inputs: [] },
  { type: "error", name: "InsufficientTokenBalance", inputs: [] },
  { type: "error", name: "InvalidWithdrawalAmount", inputs: [] },
  { type: "error", name: "OnlyFactory", inputs: [] },
  { type: "error", name: "InvalidFee", inputs: [] },
  { type: "error", name: "InvalidFeeCollector", inputs: [] },
  { type: "error", name: "InsufficientGasFee", inputs: [] },
  { type: "error", name: "InvalidRelayer", inputs: [] },
  { type: "error", name: "OnlyRelayer", inputs: [] },
];


