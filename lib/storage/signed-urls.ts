import type { SupabaseClient } from "@supabase/supabase-js";

type FileReference = { bucket: string | null; path: string | null };

// Read-only and request-local: never share private URLs across users or switch
// credentials. Callers supply the same authorised client used for single links.
export async function signFileUrls(
  client: Pick<SupabaseClient, "storage">,
  files: readonly FileReference[],
  expiresIn: number,
): Promise<(string | null)[]> {
  const buckets = new Map<string, Set<string>>();
  for (const file of files) {
    if (!file.bucket || !file.path) continue;
    const paths = buckets.get(file.bucket) ?? new Set<string>();
    paths.add(file.path);
    buckets.set(file.bucket, paths);
  }
  const jobs: { bucket: string; paths: string[] }[] = [];
  for (const [bucket, uniquePaths] of buckets) {
    const paths = [...uniquePaths];
    for (let i = 0; i < paths.length; i += 50) jobs.push({ bucket, paths: paths.slice(i, i + 50) });
  }
  const urls = new Map<string, Map<string, string>>();
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const { bucket, paths } = jobs[next++];
      const { data, error } = await client.storage.from(bucket).createSignedUrls(paths, expiresIn);
      if (error) continue;
      const byPath = urls.get(bucket) ?? new Map<string, string>();
      const requested = new Set(paths);
      for (const file of data ?? []) {
        if (file.path && requested.has(file.path) && !file.error && file.signedUrl) {
          byPath.set(file.path, file.signedUrl);
        }
      }
      urls.set(bucket, byPath);
    }
  }
  // Bound concurrent storage requests even for large historical lists.
  await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, () => worker()));
  return files.map(file => file.bucket && file.path ? urls.get(file.bucket)?.get(file.path) ?? null : null);
}
