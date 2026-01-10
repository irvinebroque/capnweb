// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

/**
 * Cap'n Web Client - The entire SDK in ~5 lines
 * 
 * That's it. Types flow directly from the server implementation.
 * No code generation. No manual sync. Just import and use.
 */

import { newHttpBatchRpcSession } from 'capnweb';
import type { Api } from '../../src/worker';

export const createCapnWebClient = () => newHttpBatchRpcSession<Api>('/rpc');
