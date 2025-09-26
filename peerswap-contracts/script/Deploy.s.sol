// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";
import { IERC20 } from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import { EscrowFactory } from "../src/EscrowFactory.sol";
import { EscrowSrc } from "../src/EscrowSrc.sol";
import { EscrowDst } from "../src/EscrowDst.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address feeCollector = vm.envAddress("FEE_COLLECTOR");
        uint32 rescueDelay = uint32(vm.envUint("RESCUE_DELAY"));
        address accessToken = vm.envAddress("ACCESS_TOKEN");
        address relayer = vm.envAddress("RELAYER");
        
        vm.startBroadcast(deployerPrivateKey);

        // Deploy implementation contracts (factory will be set during clone initialization)
        EscrowSrc escrowSrcImpl = new EscrowSrc(rescueDelay, IERC20(accessToken));
        EscrowDst escrowDstImpl = new EscrowDst(rescueDelay, IERC20(accessToken));

        // Deploy the real factory with implementation addresses
        EscrowFactory factory = new EscrowFactory(
            address(escrowSrcImpl),
            address(escrowDstImpl),
            rescueDelay,
            IERC20(accessToken),
            feeCollector,
            relayer
        );

        vm.stopBroadcast();
        
        console.log("=== PeerSwap Deployment Complete ===");
        console.log("EscrowSrc Implementation:", address(escrowSrcImpl));
        console.log("EscrowDst Implementation:", address(escrowDstImpl));
        console.log("EscrowFactory:", address(factory));
        console.log("Fee Collector:", feeCollector);
        console.log("Relayer:", relayer);
        console.log("Rescue Delay:", rescueDelay);
        console.log("Access Token:", accessToken);
        console.log("Platform Fee:", factory.platformFee());
        console.log("=====================================");
    }
}
