import { afterEach, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../src/client/api';
afterEach(()=>vi.unstubAllGlobals());
it('recognizes an expired login returning HTML instead of treating it as malformed data', async()=>{
  vi.stubGlobal('fetch', async()=>new Response('<html>Sign in</html>',{headers:{'content-type':'text/html'}}));
  await expect(api.tasks.list()).rejects.toMatchObject({status:401});
  await expect(api.tasks.list()).rejects.toBeInstanceOf(ApiError);
});
