import type { FastifyInstance, FastifyReply } from 'fastify';
import { submitSignedTx, type TxBuildContext } from '@noether/tx-builders';

interface SubmitBody {
  signedXdr: string;
  pollTimeoutMs?: number;
}

export interface TxRoutesDeps {
  txCtx: TxBuildContext;
  /** Test override that mirrors submitSignedTx. */
  submit?: typeof submitSignedTx;
}

export async function registerTxRoutes(app: FastifyInstance, deps: TxRoutesDeps): Promise<void> {
  const submit = deps.submit ?? submitSignedTx;

  app.post<{ Body: SubmitBody }>(
    '/v1/tx/submit',
    {
      preHandler: app.requireAuth,
      schema: {
        description:
          'Submit a signed Soroban transaction (base64 XDR) and poll until SUCCESS, FAILED, or pollTimeoutMs (default 30s).',
        tags: ['trading'],
        body: {
          type: 'object',
          required: ['signedXdr'],
          properties: {
            signedXdr: { type: 'string', minLength: 4 },
            pollTimeoutMs: { type: 'integer', minimum: 1000, maximum: 60000 },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const { signedXdr, pollTimeoutMs } = req.body;
        const result = await submit(deps.txCtx, signedXdr, { pollTimeoutMs });
        return reply.send({
          hash: result.hash,
          status: result.status,
          ledger: result.result?.status === 'SUCCESS' ? (result.result as { ledger?: number }).ledger : undefined,
        });
      } catch (err) {
        return mapSubmitError(err, reply);
      }
    },
  );
}

function mapSubmitError(err: unknown, reply: FastifyReply): FastifyReply {
  const message = err instanceof Error ? err.message : String(err);
  if (err && typeof err === 'object') {
    const name = (err as { name?: string }).name;
    if (name === 'TxSubmitError') {
      return reply.code(400).send({ error: 'submission_rejected', message });
    }
  }
  reply.log.error({ err }, 'tx/submit failed');
  return reply.code(502).send({ error: 'rpc_error', message });
}
