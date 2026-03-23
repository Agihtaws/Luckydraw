// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title  ISomniaReactivityPrecompile
/// @notice Interface for the Somnia Reactivity Precompile
/// @dev    Precompile lives at 0x0000000000000000000000000000000000000100
///         Field names and order match Somnia documentation exactly.
interface ISomniaReactivityPrecompile {
    struct SubscriptionData {
        bytes32[4] eventTopics;          
        address    origin;               
        address    caller;               
        address    emitter;              
        address    handlerContractAddress; 
        bytes4     handlerFunctionSelector; 
        uint64     priorityFeePerGas;    
        uint64     maxFeePerGas;         
        uint64     gasLimit;             
        bool       isGuaranteed;         
        bool       isCoalesced;          
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
