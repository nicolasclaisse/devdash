import { Hono } from 'hono';
import { S3Client, ListBucketsCommand, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { log } from './sse.js';
import { loadConfig } from './config.js';
let client = null;
function getClient() {
    const cfg = loadConfig().s3;
    if (!cfg)
        return null;
    if (!client)
        client = new S3Client({
            endpoint: cfg.endpoint,
            region: cfg.region ?? 'us-east-1',
            credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
            forcePathStyle: cfg.forcePathStyle ?? true,
        });
    return client;
}
export const s3Routes = new Hono();
s3Routes.get('/buckets', async (c) => {
    const s3 = getClient();
    if (!s3)
        return c.json({ error: 's3 not configured' }, 501);
    try {
        const { Buckets } = await s3.send(new ListBucketsCommand({}));
        return c.json({ buckets: (Buckets ?? []).map(b => ({ name: b.Name, createdAt: b.CreationDate })) });
    }
    catch (e) {
        log(`[s3] list buckets error: ${e instanceof Error ? e.message : e}`);
        return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
    }
});
s3Routes.get('/browse/:bucket', async (c) => {
    const s3 = getClient();
    if (!s3)
        return c.json({ error: 's3 not configured' }, 501);
    const bucket = c.req.param('bucket');
    const prefix = c.req.query('prefix') ?? '';
    try {
        const res = await s3.send(new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            Delimiter: '/',
            MaxKeys: 500,
        }));
        return c.json({
            folders: (res.CommonPrefixes ?? []).map(p => p.Prefix),
            objects: (res.Contents ?? [])
                .filter(o => o.Key !== prefix)
                .map(o => ({ key: o.Key, size: o.Size ?? 0, lastModified: o.LastModified })),
            truncated: res.IsTruncated ?? false,
        });
    }
    catch (e) {
        log(`[s3] browse error: ${e instanceof Error ? e.message : e}`);
        return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
    }
});
s3Routes.get('/presign/:bucket', async (c) => {
    const s3 = getClient();
    if (!s3)
        return c.json({ error: 's3 not configured' }, 501);
    const bucket = c.req.param('bucket');
    const key = c.req.query('key');
    if (!key)
        return c.json({ error: 'key required' }, 400);
    try {
        const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 3600 });
        return c.json({ url });
    }
    catch (e) {
        return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
    }
});
