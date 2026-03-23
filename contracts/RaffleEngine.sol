// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import { SomniaEventHandler } from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";
import "./IRaffleEngine.sol";
import "./interfaces/ISomniaReactivityPrecompile.sol";

/// @title  RaffleEngine
/// @notice Fully autonomous recurring raffle powered by Somnia Reactivity.
///
/// @dev    Deployment sequence:
///         1. Deploy this contract
///         2. Call fundBuffer{ value: 32 ether }()
///            The contract must hold >= 32 STT as a subscription balance requirement.
///            This amount is NOT consumed per invocation — it is a minimum holding.
///         3. Call createCampaign{ value: prizePool }(...) to start a campaign.
///         After step 3, everything is driven by Somnia Schedule events. No server
///         or cron job is required for the raffle to run indefinitely.
///
/// @dev    Fixes applied vs original:
///         FIX 1 — Pool depletion: emit PoolDepleted, decrement activeCampaignCount,
///                 guard both the complete-round path and the rollover path.
///         FIX 2 — Rollover cap double-count: removed erroneous `+ rollover` from cap
///                 calculation. remainingPool already contains the rolled-over amount.
///         FIX 3 — getWinners: added roundWinners mapping, populated in _drawRound,
///                 exposed via getWinners() view function.
contract RaffleEngine is IRaffleEngine, SomniaEventHandler, ReentrancyGuard, Ownable {

    // =========================================================
    // Constants
    // =========================================================

    address  private constant REACTIVITY_PRECOMPILE = 0x0000000000000000000000000000000000000100;
    bytes32  private constant SCHEDULE_SELECTOR     = keccak256("Schedule(uint256)");
    bytes4   private constant ON_EVENT_SELECTOR     = bytes4(keccak256("onEvent(address,bytes32[],bytes)"));

    uint8    private constant ACTION_OPEN  = 1;
    uint8    private constant ACTION_DRAW  = 2;

    uint8    private constant MAX_WINNERS            = 10;
    uint64   private constant MIN_ENTRY_WINDOW_SECS  = 60;
    uint64   private constant MIN_REPEAT_SECS        = 120;
    uint64   private constant MIN_FIRST_DELAY_MS     = 10_000;
    uint256  private constant MIN_SUBSCRIPTION_BUFFER = 32 ether;

    // Maximum attempts to resolve a same-second timestamp collision
    uint256  private constant MAX_COLLISION_ATTEMPTS = 100;

    // Gas params per Somnia documentation (1 nanoSomi = 1 gwei equivalent on Somnia)
    //
    // OPEN handler: single state write + one event — low complexity
    uint64  private constant PRIORITY_FEE_OPEN = 2_000_000_000;  //  2 gwei (docs minimum: must be >= 2 gwei per debugging guide)
    uint64  private constant MAX_FEE_OPEN      = 10_000_000_000;  // 10 gwei
    uint64  private constant GAS_LIMIT_OPEN    = 2_000_000;       //  2M gas

    // DRAW handler: winner loop + ETH transfers + precompile subscribe call — high complexity
    uint64  private constant PRIORITY_FEE_DRAW = 10_000_000_000;  // 10 gwei
    uint64  private constant MAX_FEE_DRAW      = 20_000_000_000;  // 20 gwei
    uint64  private constant GAS_LIMIT_DRAW    = 10_000_000;      // 10M gas

    // =========================================================
    // State
    // =========================================================

    ISomniaReactivityPrecompile private immutable precompile;

    uint64   private campaignCounter;
    uint64   private roundCounter;
    uint64   private activeCampaignCount;
    uint256  private subscriptionBuffer;

    mapping(uint64  => Campaign)                   private campaigns;
    mapping(uint64  => Round)                      private rounds;
    mapping(uint64  => uint64)                     private campaignCurrentRound;
    mapping(uint64  => address[])                  private roundEntrants;
    mapping(uint64  => address[])                  private roundWinners;          // FIX 3
    mapping(uint64  => mapping(address => bool))   private enteredRound;
    mapping(uint256 => PendingAction)              private pendingActions;
    mapping(uint64  => uint64[2])                  private roundSubIds;
    mapping(uint64  => mapping(address => uint64)) private lastWonRoundNum;
    mapping(address => uint256)                    private failedPrizes;

    // =========================================================
    // Constructor
    // =========================================================

    constructor() {
        precompile = ISomniaReactivityPrecompile(REACTIVITY_PRECOMPILE);
    }

    receive() external payable {}

    // =========================================================
    // Buffer Management
    // =========================================================

    /// @notice Deposit STT as the Somnia subscription balance.
    ///         The contract must hold >= 32 STT at all times while subscriptions
    ///         are active. This is a holding requirement, not a per-call fee.
    function fundBuffer() external payable override {
        if (msg.value == 0) revert InsufficientPool();
        subscriptionBuffer += msg.value;
        emit BufferFunded(msg.sender, msg.value, subscriptionBuffer);
    }

    /// @notice Withdraw the buffer. Only callable when all campaigns are done.
    function withdrawBuffer() external override onlyOwner {
        if (activeCampaignCount > 0) revert ActiveCampaignsExist();
        uint256 amount     = subscriptionBuffer;
        subscriptionBuffer = 0;
        _safeTransfer(owner(), amount);
        emit BufferWithdrawn(owner(), amount);
    }

    // =========================================================
    // createCampaign
    // =========================================================

    /// @notice Create and fund a new raffle campaign.
    /// @param numWinners         Winners per draw (1–10).
    /// @param prizePerWinner     STT per winner (wei). Total must equal msg.value.
    /// @param entryFee           STT entry fee (0 = free). Fee is added to prize pool.
    /// @param entryWindowSecs    Seconds entries stay open after RaffleOpened fires (>= 60).
    /// @param repeatIntervalSecs Seconds between draw time and next open time (> entryWindowSecs).
    /// @param prizeMode          EQUAL: identical prizes. TIERED: 50/30/20 split for top 3.
    /// @param cooldownEnabled    If true, previous round's winner(s) cannot win again next round.
    /// @param firstOpenDelayMs   Milliseconds from now until the first round opens (>= 10 000).
    function createCampaign(
        uint8     numWinners,
        uint256   prizePerWinner,
        uint256   entryFee,
        uint64    entryWindowSecs,
        uint64    repeatIntervalSecs,
        IRaffleEngine.PrizeMode prizeMode,
        bool      cooldownEnabled,
        uint64    firstOpenDelayMs
    ) external payable override {
        if (numWinners == 0 || numWinners > MAX_WINNERS)  revert InvalidNumWinners();
        if (prizePerWinner == 0)                          revert InvalidPrizeAmount();
        if (entryWindowSecs < MIN_ENTRY_WINDOW_SECS)      revert InvalidEntryWindow();
        if (repeatIntervalSecs < MIN_REPEAT_SECS)         revert InvalidRepeatInterval();
        if (repeatIntervalSecs <= entryWindowSecs)        revert InvalidRepeatInterval();
        if (firstOpenDelayMs < MIN_FIRST_DELAY_MS)        revert InvalidFirstOpenDelay();
        if (subscriptionBuffer < MIN_SUBSCRIPTION_BUFFER) revert BufferNotFunded();
        if (msg.value < uint256(numWinners) * prizePerWinner) revert InsufficientPool();

        campaignCounter++;
        uint64 campaignId = campaignCounter;

        campaigns[campaignId] = Campaign({
            id:                 campaignId,
            admin:              msg.sender,
            numWinners:         numWinners,
            prizePerWinner:     prizePerWinner,
            entryFee:           entryFee,
            entryWindowSecs:    entryWindowSecs,
            repeatIntervalSecs: repeatIntervalSecs,
            prizeMode:          prizeMode,
            cooldownEnabled:    cooldownEnabled,
            paused:             false,
            cancelled:          false,
            totalPool:          msg.value,
            remainingPool:      msg.value,
            totalRoundsRun:     0,
            totalWinnersPaid:   0,
            totalDistributed:   0
        });

        activeCampaignCount++;

        uint256 openMs  = block.timestamp * 1000 + uint256(firstOpenDelayMs);
        uint256 drawMs  = openMs + uint256(entryWindowSecs) * 1000;

        // FIX: first round pool = one round's worth of prizes, NOT the full msg.value.
        // msg.value may cover multiple rounds (e.g. 10 STT for 5 x 2 STT rounds).
        // _calcPrizes distributes r.pool equally among winners — passing the full
        // msg.value would pay the entire multi-round pool to the first winner.
        uint256 stdPool = uint256(numWinners) * prizePerWinner;
        uint64 roundId  = _newRound(campaignId, 1, openMs, drawMs, stdPool, false);
        campaignCurrentRound[campaignId] = roundId;
        _schedulePair(campaignId, roundId, openMs, drawMs);

        emit CampaignCreated(
            campaignId, msg.sender, numWinners, prizePerWinner,
            entryFee, entryWindowSecs, repeatIntervalSecs,
            prizeMode, cooldownEnabled, msg.value
        );
    }

    // =========================================================
    // enter
    // =========================================================

    function enter(uint64 campaignId) external payable override nonReentrant {
        Campaign storage c = campaigns[campaignId];
        if (c.id == 0)      revert CampaignDoesNotExist();
        if (c.cancelled)    revert CampaignAlreadyCancelled();
        if (msg.sender == c.admin) revert AdminCannotEnter();

        uint64         roundId = campaignCurrentRound[campaignId];
        Round  storage r       = rounds[roundId];

        if (r.status != RoundStatus.OPEN)          revert EntryWindowNotOpen();
        if (block.timestamp >= r.drawTime)         revert EntryWindowNotOpen();
        if (enteredRound[roundId][msg.sender])     revert AlreadyEntered();

        if (c.entryFee > 0) {
            if (msg.value < c.entryFee) revert InsufficientEntryFee(c.entryFee, msg.value);
            // Refund any overpayment
            if (msg.value > c.entryFee) _safeTransfer(msg.sender, msg.value - c.entryFee);
            r.pool          += c.entryFee;
            c.remainingPool += c.entryFee;
            c.totalPool     += c.entryFee;
        } else {
            // Free entry — refund any accidentally sent value
            if (msg.value > 0) _safeTransfer(msg.sender, msg.value);
        }

        enteredRound[roundId][msg.sender] = true;
        roundEntrants[roundId].push(msg.sender);
        r.entryCount++;

        emit EntrySubmitted(campaignId, roundId, msg.sender, r.entryCount);
    }

    // =========================================================
    // _onEvent  — Somnia Reactivity entry point
    // =========================================================

    /// @dev Called by Somnia validators (msg.sender == 0x0100) when a
    ///      Schedule subscription fires. The emitter of a system Schedule
    ///      event is always the Reactivity Precompile itself.
    ///
    ///      NOTE: We do NOT double-check emitter here. The subscription was
    ///      created with emitter = REACTIVITY_PRECOMPILE as a filter, so the
    ///      precompile will not invoke this handler unless the source matches.
    ///      A redundant emitter check here can silently break execution if the
    ///      precompile internally passes a different address representation.
    ///
    ///      eventTopics layout for Schedule events (per Somnia docs):
    ///        [0] = keccak256("Schedule(uint256)")
    ///        [1] = timestamp in milliseconds (the value passed at subscribe time)
    function _onEvent(
        address,
        bytes32[] calldata eventTopics,
        bytes     calldata
    ) internal override {
        // ROOT CAUSE FIX:
        // Somnia precompile fires _onEvent with the ACTUAL block timestamp in topic[1],
        // not the exact ms we subscribed with (confirmed: 7ms off in practice).
        // e.g. we stored at key 1774119166000 but precompile fired with 1774119166007.
        //
        // Fix: divide topic[1] by 1000 before lookup (integer division rounds to same second).
        // We also store pendingActions keyed by (tsMs / 1000) so both sides match exactly.

        if (eventTopics.length < 2)              return;
        if (eventTopics[0] != SCHEDULE_SELECTOR) return;

        // Divide fired timestamp by 1000 — matches the second-level key we stored
        uint256 keyTs = uint256(eventTopics[1]) / 1000;

        PendingAction memory pa = pendingActions[keyTs];
        if (pa.campaignId == 0) return;

        delete pendingActions[keyTs];

        if      (pa.action == ACTION_OPEN) _openRound(pa.roundId);
        else if (pa.action == ACTION_DRAW) _drawRound(pa.campaignId, pa.roundId);
    }

    // =========================================================
    // _openRound
    // =========================================================

    function _openRound(uint64 roundId) private {
        Round    storage r = rounds[roundId];
        Campaign storage c = campaigns[r.campaignId];

        if (r.status != RoundStatus.UPCOMING) return;

        if (c.cancelled) {
            r.status = RoundStatus.CANCELLED;
            return;
        }

        r.status = RoundStatus.OPEN;
        emit RaffleOpened(r.campaignId, roundId, r.roundNumber, r.pool, r.drawTime);
    }

    // =========================================================
    // _drawRound
    // =========================================================

    function _drawRound(uint64 campaignId, uint64 roundId) private {
        Round    storage r = rounds[roundId];
        Campaign storage c = campaigns[campaignId];

        // Guard: only process rounds that are in a drawable state
        if (r.status == RoundStatus.DRAWING    ||
            r.status == RoundStatus.COMPLETE   ||
            r.status == RoundStatus.ROLLEDOVER ||
            r.status == RoundStatus.CANCELLED) return;

        if (c.cancelled) {
            r.status = RoundStatus.CANCELLED;
            return;
        }

        // Lock entries immediately
        r.status = RoundStatus.DRAWING;
        c.totalRoundsRun++;

        uint256 stdPool = uint256(c.numWinners) * c.prizePerWinner;

        // -------------------------------------------------------
        // Zero entries — rollover
        // -------------------------------------------------------
        if (r.entryCount == 0) {
            r.status = RoundStatus.ROLLEDOVER;

            if (!c.paused && !c.cancelled) {
                // FIX 1 (rollover path): guard pool before scheduling next round
                if (c.remainingPool >= stdPool) {
                    _scheduleNext(campaignId, r, r.pool);
                } else {
                    // Pool cannot cover even one standard round — campaign ends
                    if (activeCampaignCount > 0) activeCampaignCount--;
                    emit PoolDepleted(campaignId);
                }
            }

            uint64 nextId = roundCounter + 1;
            emit RoundRolledOver(campaignId, roundId, nextId, r.pool);
            return;
        }

        // -------------------------------------------------------
        // Has entries — select winners and distribute
        // -------------------------------------------------------
        r.blockHashUsed = blockhash(block.number - 1);

        address[] memory winners = _selectWinners(
            roundId, c.numWinners, c.cooldownEnabled, campaignId, r.roundNumber
        );
        uint256[] memory prizes = _calcPrizes(r.pool, c.prizeMode, winners.length);

        // FIX 3: store winners on-chain for getWinners() view
        for (uint256 i = 0; i < winners.length; i++) {
            roundWinners[roundId].push(winners[i]);
        }

        emit WinnersSelected(campaignId, roundId, winners, prizes, r.blockHashUsed);

        uint256 distributed = _distribute(campaignId, roundId, winners, prizes, r.roundNumber);

        // Deduct the full round pool. Any failed-prize amounts are held in
        // failedPrizes[] and claimable by winners via claimFailedPrize().
        c.remainingPool    = c.remainingPool >= r.pool ? c.remainingPool - r.pool : 0;
        c.totalDistributed += distributed;
        r.status            = RoundStatus.COMPLETE;

        // FIX 1 (complete path): guard pool and decrement activeCampaignCount on depletion
        if (!c.paused && !c.cancelled) {
            if (c.remainingPool >= stdPool) {
                _scheduleNext(campaignId, r, 0);
            } else {
                if (activeCampaignCount > 0) activeCampaignCount--;
                emit PoolDepleted(campaignId);
            }
        }
    }

    // =========================================================
    // _selectWinners
    // =========================================================

    function _selectWinners(
        uint64 roundId,
        uint8  numWinners,
        bool   cooldown,
        uint64 campaignId,
        uint64 roundNumber
    ) private view returns (address[] memory) {
        address[] storage ents  = roundEntrants[roundId];
        uint256           total = ents.length;
        uint256           want  = numWinners > total ? total : numWinners;

        address[] memory winners  = new address[](want);
        bool[]    memory selected = new bool[](total);
        bytes32          seed     = blockhash(block.number - 1);

        uint256 found    = 0;
        uint256 attempts = 0;
        uint256 maxAtt   = total * 4;

        while (found < want && attempts < maxAtt) {
            uint256 idx = uint256(
                keccak256(abi.encodePacked(seed, roundId, found, attempts))
            ) % total;

            if (!selected[idx]) {
                address candidate = ents[idx];
                bool    skip      = false;

                if (cooldown && roundNumber > 1) {
                    if (lastWonRoundNum[campaignId][candidate] == roundNumber - 1) {
                        skip = true;
                    }
                }

                if (!skip) {
                    selected[idx]  = true;
                    winners[found] = candidate;
                    found++;
                }
            }
            attempts++;
        }

        // Trim array to actual found count if cooldown prevented filling all slots
        if (found < want) {
            assembly { mstore(winners, found) }
        }
        return winners;
    }

    // =========================================================
    // _calcPrizes
    // =========================================================

    function _calcPrizes(
        uint256   pool,
        PrizeMode mode,
        uint256   count
    ) private pure returns (uint256[] memory prizes) {
        prizes = new uint256[](count);
        if (count == 0 || pool == 0) return prizes;

        if (mode == PrizeMode.TIERED && count > 1) {
            if (count == 2) {
                prizes[0] = (pool * 60) / 100;
                prizes[1] = pool - prizes[0];
            } else if (count == 3) {
                prizes[0] = (pool * 50) / 100;
                prizes[1] = (pool * 30) / 100;
                prizes[2] = pool - prizes[0] - prizes[1];
            } else {
                // Tiered only defined for 2–3; fall back to equal for 4+
                _splitEqual(prizes, pool, count);
            }
        } else {
            _splitEqual(prizes, pool, count);
        }
    }

    function _splitEqual(uint256[] memory p, uint256 pool, uint256 n) private pure {
        uint256 each = pool / n;
        uint256 rem  = pool - each * n;
        for (uint256 i = 0; i < n; i++) p[i] = each;
        // Remainder (due to integer division) goes to first winner
        p[0] += rem;
    }

    // =========================================================
    // _distribute
    // =========================================================

    function _distribute(
        uint64    campaignId,
        uint64    roundId,
        address[] memory winners,
        uint256[] memory prizes,
        uint64    roundNumber
    ) private returns (uint256 totalSent) {
        Campaign storage c = campaigns[campaignId];
        totalSent = 0;

        for (uint8 i = 0; i < winners.length; i++) {
            address w = winners[i];
            uint256 p = prizes[i];
            if (w == address(0) || p == 0) continue;

            // Record win before transfer to satisfy cooldown check in next round
            lastWonRoundNum[campaignId][w] = roundNumber;

            (bool ok,) = w.call{value: p}("");
            if (ok) {
                totalSent += p;
                c.totalWinnersPaid++;
                emit PrizeSent(campaignId, roundId, w, i + 1, p);
            } else {
                // Do NOT revert — log failure and let winner pull manually
                failedPrizes[w] += p;
                emit PrizeTransferFailed(campaignId, roundId, w, p);
            }
        }
    }

    // =========================================================
    // _scheduleNext
    // =========================================================

    function _scheduleNext(
        uint64  campaignId,
        Round   storage prev,
        uint256 rollover
    ) private {
        Campaign storage c = campaigns[campaignId];

        uint256 calculatedOpenMs = (uint256(prev.drawTime) + uint256(c.repeatIntervalSecs)) * 1000;

        // If the campaign was paused for longer than repeatIntervalSecs, the
        // calculated open time lands in the past. The Somnia precompile requires
        // all Schedule timestamps to be in the future (minimum ~12 seconds ahead).
        // We take the later of: the natural cadence time, or now + MIN_FIRST_DELAY_MS.
        uint256 earliestMs = block.timestamp * 1000 + uint256(MIN_FIRST_DELAY_MS);
        uint256 openMs     = calculatedOpenMs > earliestMs ? calculatedOpenMs : earliestMs;
        uint256 drawMs     = openMs + uint256(c.entryWindowSecs) * 1000;

        uint256 stdPool = uint256(c.numWinners) * c.prizePerWinner;

        // FIX 2: cap uses remainingPool only.
        // remainingPool already contains the rollover amount because no prizes
        // were paid in a rolled-over round, so adding rollover again would
        // inflate cap beyond what the contract actually holds.
        uint256 nextPool = stdPool + rollover;
        uint256 cap      = c.remainingPool;       // FIX 2: was `c.remainingPool + rollover`
        if (nextPool > cap) nextPool = cap;

        uint64 rid = _newRound(
            campaignId, prev.roundNumber + 1, openMs, drawMs, nextPool, rollover > 0
        );
        campaignCurrentRound[campaignId] = rid;
        _schedulePair(campaignId, rid, openMs, drawMs);

        emit NextRoundScheduled(campaignId, rid, uint64(openMs / 1000), uint64(drawMs / 1000));
    }

    // =========================================================
    // _newRound
    // =========================================================

    function _newRound(
        uint64  campaignId,
        uint64  roundNumber,
        uint256 openMs,
        uint256 drawMs,
        uint256 pool,
        bool    rollover
    ) private returns (uint64 rid) {
        roundCounter++;
        rid = roundCounter;
        rounds[rid] = Round({
            id:               rid,
            campaignId:       campaignId,
            roundNumber:      roundNumber,
            status:           RoundStatus.UPCOMING,
            openTime:         uint64(openMs / 1000),
            drawTime:         uint64(drawMs / 1000),
            entryCount:       0,
            pool:             pool,
            blockHashUsed:    bytes32(0),
            rolloverIncluded: rollover
        });
    }

    // =========================================================
    // _schedulePair
    // =========================================================

    function _schedulePair(
        uint64  cid,
        uint64  rid,
        uint256 openMs,
        uint256 drawMs
    ) private {
        uint64 oid = _scheduleSub(openMs, cid, rid, ACTION_OPEN);
        uint64 did = _scheduleSub(drawMs, cid, rid, ACTION_DRAW);
        roundSubIds[rid] = [oid, did];
    }

    // =========================================================
    // _scheduleSub
    // =========================================================

    function _scheduleSub(
        uint256 tsMs,
        uint64  cid,
        uint64  rid,
        uint8   action
    ) private returns (uint64 subId) {
        // KEY BY SECONDS — precompile fires at actual block ms which may differ
        // by a few ms from our subscribed ms, but the second is always the same.
        // Both (storedMs / 1000) and (firedMs / 1000) round to identical key.
        uint256 keyTs = tsMs / 1000;

        // Collision: two rounds scheduled in the same second — shift by 1 second
        uint256 attempts = 0;
        while (pendingActions[keyTs].campaignId != 0) {
            keyTs++;
            attempts++;
            if (attempts >= MAX_COLLISION_ATTEMPTS) revert ScheduleCollision();
        }

        pendingActions[keyTs] = PendingAction({
            campaignId: cid,
            roundId:    rid,
            action:     action
        });

        bool isDraw = (action == ACTION_DRAW);

        // Sync subscription ms to the resolved key so _onEvent lookup always matches,
        // even when keyTs was shifted by 1+ due to a same-second collision.
        // e.g. if collision moved keyTs from 1774119166 to 1774119167,
        // we subscribe at 1774119167000 so precompile fires at ~that second,
        // and _onEvent computes 1774119167xxx / 1000 = 1774119167 — matches.
        uint256 subMs = keyTs * 1000;

        bytes32[4] memory topics;
        topics[0] = SCHEDULE_SELECTOR;
        topics[1] = bytes32(subMs);   // aligned to resolved keyTs, not original tsMs
        topics[2] = bytes32(0);
        topics[3] = bytes32(0);

        ISomniaReactivityPrecompile.SubscriptionData memory sd =
            ISomniaReactivityPrecompile.SubscriptionData({
                eventTopics:              topics,
                origin:                   address(0),
                caller:                   address(0),
                emitter:                  REACTIVITY_PRECOMPILE,
                handlerContractAddress:   address(this),
                handlerFunctionSelector:  ON_EVENT_SELECTOR,
                priorityFeePerGas:        isDraw ? PRIORITY_FEE_DRAW : PRIORITY_FEE_OPEN,
                maxFeePerGas:             isDraw ? MAX_FEE_DRAW       : MAX_FEE_OPEN,
                gasLimit:                 isDraw ? GAS_LIMIT_DRAW     : GAS_LIMIT_OPEN,
                isGuaranteed:             true,     // both OPEN and DRAW must always execute
                isCoalesced:              false
            });

        subId = precompile.subscribe(sd);
    }

    // =========================================================
    // Admin Functions
    // =========================================================

    function topUpPool(uint64 campaignId) external payable override {
        Campaign storage c = campaigns[campaignId];
        if (c.id == 0)             revert CampaignDoesNotExist();
        if (c.cancelled)           revert CampaignAlreadyCancelled();
        if (msg.sender != c.admin) revert NotCampaignAdmin();
        if (msg.value == 0)        revert InsufficientPool();

        c.totalPool     += msg.value;
        c.remainingPool += msg.value;
        emit PoolToppedUp(campaignId, msg.sender, msg.value, c.remainingPool);
    }

    function pauseCampaign(uint64 campaignId) external override {
        Campaign storage c = campaigns[campaignId];
        if (c.id == 0)             revert CampaignDoesNotExist();
        if (c.cancelled)           revert CampaignAlreadyCancelled();
        if (c.paused)              revert CampaignAlreadyPaused();
        if (msg.sender != c.admin) revert NotCampaignAdmin();

        c.paused = true;
        emit CampaignPaused(campaignId, msg.sender);
    }

    function resumeCampaign(uint64 campaignId) external override {
        Campaign storage c = campaigns[campaignId];
        if (c.id == 0)             revert CampaignDoesNotExist();
        if (c.cancelled)           revert CampaignAlreadyCancelled();
        if (!c.paused)             revert CampaignNotPaused();
        if (msg.sender != c.admin) revert NotCampaignAdmin();

        c.paused = false;

        // If the current round already completed while paused, schedule the next
        // round immediately (it would not have been scheduled at draw time because
        // the campaign was paused).
        uint64         rid     = campaignCurrentRound[campaignId];
        Round  storage r       = rounds[rid];
        uint256        stdPool = uint256(c.numWinners) * c.prizePerWinner;

        if ((r.status == RoundStatus.COMPLETE || r.status == RoundStatus.ROLLEDOVER)
            && c.remainingPool >= stdPool)
        {
            uint256 ro = (r.status == RoundStatus.ROLLEDOVER) ? r.pool : 0;
            _scheduleNext(campaignId, r, ro);
        }

        emit CampaignResumed(campaignId, msg.sender);
    }

    function emergencyCancel(uint64 campaignId) external override nonReentrant {
        Campaign storage c = campaigns[campaignId];
        if (c.id == 0)             revert CampaignDoesNotExist();
        if (c.cancelled)           revert CampaignAlreadyCancelled();
        if (msg.sender != c.admin) revert NotCampaignAdmin();

        c.cancelled = true;


        // NOTE: We intentionally do NOT call precompile.unsubscribe() here.
        // Schedule subscriptions are one-off and auto-delete after firing.
        // Calling unsubscribe() on an already-consumed subscription reverts
        // even inside try/catch when the call comes from a precompile context.
        // If a pending subscription fires after cancel, _onEvent checks
        // c.cancelled and exits immediately — no state change, no harm.

        // Mark round as cancelled if it hasn't drawn yet
        Round storage r = rounds[campaignCurrentRound[campaignId]];
        if (r.status == RoundStatus.UPCOMING || r.status == RoundStatus.OPEN) {
            r.status = RoundStatus.CANCELLED;
        }

        if (activeCampaignCount > 0) activeCampaignCount--;

        uint256 refund  = c.remainingPool;
        c.remainingPool = 0;
        if (refund > 0) _safeTransfer(c.admin, refund);

        emit CampaignCancelled(campaignId, msg.sender, refund);
    }

    /// @notice Winners whose prize transfer failed can pull their STT here.
    function claimFailedPrize() external override nonReentrant {
        uint256 amount = failedPrizes[msg.sender];
        if (amount == 0) revert NoFailedPrizeToClaim();
        failedPrizes[msg.sender] = 0;
        _safeTransfer(msg.sender, amount);
        emit FailedPrizeClaimed(msg.sender, amount);
    }

    // =========================================================
    // View Functions
    // =========================================================

    function getCampaign(uint64 id)
        external view override returns (Campaign memory) { return campaigns[id]; }

    function getCurrentRound(uint64 campaignId)
        external view override returns (Round memory) { return rounds[campaignCurrentRound[campaignId]]; }

    function getRound(uint64 roundId)
        external view override returns (Round memory) { return rounds[roundId]; }

    function getEntrants(uint64 roundId)
        external view override returns (address[] memory) { return roundEntrants[roundId]; }

    /// @notice Returns the winner addresses for a completed round.
    ///         Returns empty array for rounds not yet drawn. (FIX 3)
    function getWinners(uint64 roundId)
        external view override returns (address[] memory) { return roundWinners[roundId]; }

    function hasEntered(uint64 roundId, address wallet)
        external view override returns (bool) { return enteredRound[roundId][wallet]; }

    function getFailedPrizeBalance(address wallet)
        external view override returns (uint256) { return failedPrizes[wallet]; }

    function getCampaignCount()
        external view override returns (uint64) { return campaignCounter; }

    function getRoundCount()
        external view override returns (uint64) { return roundCounter; }

    function getSubscriptionBuffer()
        external view override returns (uint256) { return subscriptionBuffer; }

    function getActiveCampaignCount()
        external view override returns (uint64) { return activeCampaignCount; }

    // =========================================================
    // Internal Helper
    // =========================================================

    function _safeTransfer(address to, uint256 amount) private {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0)      return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok)   revert NativeTransferFailed();
    }
}
