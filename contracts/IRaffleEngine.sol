// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRaffleEngine {
    // Enums
    enum RoundStatus { UPCOMING, OPEN, DRAWING, COMPLETE, ROLLEDOVER, CANCELLED }
    enum PrizeMode   { EQUAL, TIERED }
    
    // Structs
    struct Campaign {
        uint64    id;
        address   admin;
        uint8     numWinners;
        uint256   prizePerWinner;
        uint256   entryFee;
        uint64    entryWindowSecs;
        uint64    repeatIntervalSecs;
        PrizeMode prizeMode;
        bool      cooldownEnabled;
        bool      paused;
        bool      cancelled;
        uint256   totalPool;
        uint256   remainingPool;
        uint64    totalRoundsRun;
        uint64    totalWinnersPaid;
        uint256   totalDistributed;
    }

    struct Round {
        uint64      id;
        uint64      campaignId;
        uint64      roundNumber;
        RoundStatus status;
        uint64      openTime;
        uint64      drawTime;
        uint32      entryCount;
        uint256     pool;
        bytes32     blockHashUsed;
        bool        rolloverIncluded;
    }

    struct PendingAction {
        uint64 campaignId;
        uint64 roundId;
        uint8  action;
    }

    // Events

    event BufferFunded(address indexed funder, uint256 amount, uint256 newTotal);
    event BufferWithdrawn(address indexed owner, uint256 amount);

    event CampaignCreated(
        uint64 indexed campaignId,
        address indexed admin,
        uint8   numWinners,
        uint256 prizePerWinner,
        uint256 entryFee,
        uint64  entryWindowSecs,
        uint64  repeatIntervalSecs,
        PrizeMode prizeMode,
        bool    cooldownEnabled,
        uint256 totalPool
    );

    event RaffleOpened(
        uint64 indexed campaignId,
        uint64 indexed roundId,
        uint64  roundNumber,
        uint256 pool,
        uint64  drawTime
    );

    event EntrySubmitted(
        uint64 indexed campaignId,
        uint64 indexed roundId,
        address indexed entrant,
        uint32  entryNumber
    );

    event RoundRolledOver(
        uint64 indexed campaignId,
        uint64 indexed roundId,
        uint64  nextRoundId,
        uint256 rolledPool
    );

    event WinnersSelected(
        uint64 indexed campaignId,
        uint64 indexed roundId,
        address[] winners,
        uint256[] prizes,
        bytes32   blockHashUsed
    );

    event PrizeSent(
        uint64 indexed campaignId,
        uint64 indexed roundId,
        address indexed winner,
        uint8   rank,
        uint256 amount
    );

    event PrizeTransferFailed(
        uint64 indexed campaignId,
        uint64 indexed roundId,
        address indexed winner,
        uint256 amount
    );

    event FailedPrizeClaimed(address indexed claimer, uint256 amount);

    event NextRoundScheduled(
        uint64 indexed campaignId,
        uint64 indexed nextRoundId,
        uint64  openTime,
        uint64  drawTime
    );

    /// @notice Emitted when the prize pool is exhausted and no further rounds
    ///         will be scheduled. Admin must topUpPool to restart.
    event PoolDepleted(uint64 indexed campaignId);

    event CampaignPaused(uint64 indexed campaignId, address indexed admin);
    event CampaignResumed(uint64 indexed campaignId, address indexed admin);
    event CampaignCancelled(uint64 indexed campaignId, address indexed admin, uint256 refunded);
    event PoolToppedUp(uint64 indexed campaignId, address indexed admin, uint256 amount, uint256 newRemaining);

    // Errors

    error NotCampaignAdmin();
    error CampaignDoesNotExist();
    error CampaignAlreadyCancelled();
    error CampaignAlreadyPaused();
    error CampaignNotPaused();
    error EntryWindowNotOpen();
    error AdminCannotEnter();
    error AlreadyEntered();
    error InsufficientEntryFee(uint256 required, uint256 provided);
    error InvalidNumWinners();
    error InvalidPrizeAmount();
    error InvalidEntryWindow();
    error InvalidRepeatInterval();
    error InvalidFirstOpenDelay();
    error InsufficientPool();
    error BufferNotFunded();
    error ActiveCampaignsExist();
    error NoFailedPrizeToClaim();
    error ZeroAddress();
    error NativeTransferFailed();
    error ScheduleCollision();

    // Write Functions

    function fundBuffer() external payable;
    function withdrawBuffer() external;

    function createCampaign(
        uint8     numWinners,
        uint256   prizePerWinner,
        uint256   entryFee,
        uint64    entryWindowSecs,
        uint64    repeatIntervalSecs,
        IRaffleEngine.PrizeMode prizeMode,
        bool      cooldownEnabled,
        uint64    firstOpenDelayMs
    ) external payable;

    function enter(uint64 campaignId) external payable;
    function topUpPool(uint64 campaignId) external payable;
    function pauseCampaign(uint64 campaignId) external;
    function resumeCampaign(uint64 campaignId) external;
    function emergencyCancel(uint64 campaignId) external;
    function claimFailedPrize() external;

    // View Functions

    function getCampaign(uint64 campaignId) external view returns (Campaign memory);
    function getCurrentRound(uint64 campaignId) external view returns (Round memory);
    function getRound(uint64 roundId) external view returns (Round memory);
    function getEntrants(uint64 roundId) external view returns (address[] memory);
    function getWinners(uint64 roundId) external view returns (address[] memory);   // FIX 3: added
    function hasEntered(uint64 roundId, address wallet) external view returns (bool);
    function getFailedPrizeBalance(address wallet) external view returns (uint256);
    function getCampaignCount() external view returns (uint64);
    function getRoundCount() external view returns (uint64);
    function getSubscriptionBuffer() external view returns (uint256);
    function getActiveCampaignCount() external view returns (uint64);
}
