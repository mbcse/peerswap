export const EscrowFactoryAbi = [
  {
    type: "function",
    stateMutability: "payable",
    name: "createSrcEscrow",
    inputs: [
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
          { name: "parameters", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "addressOfEscrowSrc",
    inputs: [
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
          { name: "parameters", type: "bytes" },
        ],
      },
    ],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "addressOfEscrowDst",
    inputs: [
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
          { name: "parameters", type: "bytes" },
        ],
      },
    ],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "SrcEscrowCreated",
    inputs: [
      {
        name: "srcExecutionData",
        type: "tuple",
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
    anonymous: false,
  },
  {
    type: "event",
    name: "DstEscrowCreated",
    inputs: [
      { name: "escrow", type: "address", indexed: false },
      { name: "hashlock", type: "bytes32", indexed: false },
      { name: "asker", type: "address", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "setFulfiller",
    inputs: [
      { name: "srcEscrowAddress", type: "address" },
      { name: "fulfillerAddress", type: "address" }
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "FulfillerSet",
    inputs: [
      { name: "srcEscrowAddress", type: "address", indexed: true },
      { name: "fulfillerAddress", type: "address", indexed: true }
    ],
    anonymous: false,
  },
  {
    type: "function",
    stateMutability: "view",
    name: "relayer",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
];


