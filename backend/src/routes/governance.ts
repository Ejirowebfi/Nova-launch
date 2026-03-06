import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { GovernanceEventParser } from '../services/governanceEventParser';

const router = Router();
const prisma = new PrismaClient();
const governanceParser = new GovernanceEventParser(prisma);

/**
 * GET /api/governance/proposals
 * Get all proposals with optional filters
 */
router.get('/proposals', async (req: Request, res: Response) => {
  try {
    const {
      status,
      proposalType,
      tokenId,
      proposer,
      limit = '50',
      offset = '0',
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (proposalType) {
      where.proposalType = proposalType;
    }

    if (tokenId) {
      where.tokenId = tokenId;
    }

    if (proposer) {
      where.proposer = proposer;
    }

    const [proposals, total] = await Promise.all([
      prisma.proposal.findMany({
        where,
        include: {
          votes: {
            select: {
              id: true,
              voter: true,
              support: true,
              weight: true,
              timestamp: true,
            },
          },
          executions: {
            select: {
              id: true,
              executor: true,
              success: true,
              executedAt: true,
            },
          },
        },
        orderBy: {
          [sortBy as string]: sortOrder,
        },
        take: parseInt(limit as string),
        skip: parseInt(offset as string),
      }),
      prisma.proposal.count({ where }),
    ]);

    // Convert BigInt to string for JSON serialization
    const serializedProposals = proposals.map(p => ({
      ...p,
      quorum: p.quorum.toString(),
      threshold: p.threshold.toString(),
      votes: p.votes.map(v => ({
        ...v,
        weight: v.weight.toString(),
      })),
    }));

    res.json({
      success: true,
      data: {
        proposals: serializedProposals,
        total,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
      },
    });
  } catch (error) {
    console.error('Error fetching proposals:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch proposals',
    });
  }
});

/**
 * GET /api/governance/proposals/:proposalId
 * Get a specific proposal by ID
 */
router.get('/proposals/:proposalId', async (req: Request, res: Response) => {
  try {
    const { proposalId } = req.params;

    const proposal = await prisma.proposal.findUnique({
      where: { proposalId: parseInt(proposalId) },
      include: {
        votes: {
          orderBy: { timestamp: 'desc' },
        },
        executions: {
          orderBy: { executedAt: 'desc' },
        },
      },
    });

    if (!proposal) {
      return res.status(404).json({
        success: false,
        error: 'Proposal not found',
      });
    }

    // Get analytics
    const analytics = await governanceParser.getProposalAnalytics(parseInt(proposalId));

    // Serialize BigInt values
    const serializedProposal = {
      ...proposal,
      quorum: proposal.quorum.toString(),
      threshold: proposal.threshold.toString(),
      votes: proposal.votes.map(v => ({
        ...v,
        weight: v.weight.toString(),
      })),
      executions: proposal.executions.map(e => ({
        ...e,
        gasUsed: e.gasUsed?.toString(),
      })),
    };

    res.json({
      success: true,
      data: {
        proposal: serializedProposal,
        analytics,
      },
    });
  } catch (error) {
    console.error('Error fetching proposal:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch proposal',
    });
  }
});

/**
 * GET /api/governance/proposals/:proposalId/votes
 * Get all votes for a specific proposal
 */
router.get('/proposals/:proposalId/votes', async (req: Request, res: Response) => {
  try {
    const { proposalId } = req.params;
    const { limit = '100', offset = '0' } = req.query;

    const proposal = await prisma.proposal.findUnique({
      where: { proposalId: parseInt(proposalId) },
    });

    if (!proposal) {
      return res.status(404).json({
        success: false,
        error: 'Proposal not found',
      });
    }

    const [votes, total] = await Promise.all([
      prisma.vote.findMany({
        where: { proposalId: proposal.id },
        orderBy: { timestamp: 'desc' },
        take: parseInt(limit as string),
        skip: parseInt(offset as string),
      }),
      prisma.vote.count({ where: { proposalId: proposal.id } }),
    ]);

    const serializedVotes = votes.map(v => ({
      ...v,
      weight: v.weight.toString(),
    }));

    res.json({
      success: true,
      data: {
        votes: serializedVotes,
        total,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
      },
    });
  } catch (error) {
    console.error('Error fetching votes:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch votes',
    });
  }
});

/**
 * GET /api/governance/stats
 * Get governance statistics
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await governanceParser.getGovernanceStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Error fetching governance stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch governance stats',
    });
  }
});

/**
 * GET /api/governance/voters/:address
 * Get voter statistics for a specific address
 */
router.get('/voters/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    const votes = await prisma.vote.findMany({
      where: { voter: address },
      include: {
        proposal: {
          select: {
            proposalId: true,
            title: true,
            status: true,
          },
        },
      },
      orderBy: { timestamp: 'desc' },
    });

    const totalVotingPower = votes.reduce((sum, v) => sum + v.weight, BigInt(0));
    const totalProposals = await prisma.proposal.count();
    const participationRate = totalProposals > 0
      ? (votes.length / totalProposals) * 100
      : 0;

    const voterStats = {
      address,
      totalVotes: votes.length,
      votingPower: totalVotingPower.toString(),
      participationRate,
      proposalsVoted: votes.map(v => v.proposal.proposalId),
      recentVotes: votes.slice(0, 10).map(v => ({
        proposalId: v.proposal.proposalId,
        proposalTitle: v.proposal.title,
        support: v.support,
        weight: v.weight.toString(),
        timestamp: v.timestamp,
      })),
    };

    res.json({
      success: true,
      data: voterStats,
    });
  } catch (error) {
    console.error('Error fetching voter stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch voter stats',
    });
  }
});

/**
 * POST /api/governance/events/ingest
 * Ingest governance events (internal endpoint)
 */
router.post('/events/ingest', async (req: Request, res: Response) => {
  try {
    const { events } = req.body;

    if (!Array.isArray(events)) {
      return res.status(400).json({
        success: false,
        error: 'Events must be an array',
      });
    }

    const results = [];

    for (const event of events) {
      try {
        await governanceParser.parseEvent(event);
        results.push({ success: true, event: event.type });
      } catch (error) {
        console.error(`Error processing event:`, error);
        results.push({
          success: false,
          event: event.type,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    res.json({
      success: true,
      data: {
        processed: results.length,
        results,
      },
    });
  } catch (error) {
    console.error('Error ingesting events:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to ingest events',
    });
  }
});

export default router;
