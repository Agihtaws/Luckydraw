// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title  ISomniaReactivityPrecompile
/// @notice Interface for the Somnia Reactivity Precompile
/// @dev    Precompile lives at 0x0000000000000000000000000000000000000100
///         Field names and order match Somnia documentation exactly.
interface ISomniaReactivityPrecompile {
    struct SubscriptionData {
        bytes32[4] eventTopics;          // Topic filter — bytes32(0) = wildcard
        address    origin;               // tx.origin filter  — address(0) = any
        address    caller;               // msg.sender filter — address(0) = any
        address    emitter;              // event emitter filter — address(0) = any
        address    handlerContractAddress; // contract to invoke on match
        bytes4     handlerFunctionSelector; // 4-byte selector of handler function
        uint64     priorityFeePerGas;    // nanoSomi tip per gas unit
        uint64     maxFeePerGas;         // nanoSomi max fee per gas unit
        uint64     gasLimit;             // max gas provisioned per invocation
        bool       isGuaranteed;         // retry in next block if current block full
        bool       isCoalesced;          // batch multiple matching events per block
    }

    event SubscriptionCreated(
        uint64 indexed subscriptionId,
        address indexed owner,
        SubscriptionData subscriptionData
    );
    event SubscriptionRemoved(
        uint64 indexed subscriptionId,
        address indexed owner
    );

    function subscribe(SubscriptionData calldata subscriptionData)
        external returns (uint64 subscriptionId);

    function unsubscribe(uint64 subscriptionId) external;

    function getSubscriptionInfo(uint64 subscriptionId)
        external view returns (SubscriptionData memory subscriptionData, address owner);
}
