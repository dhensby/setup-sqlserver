import * as coreNs from '@actions/core';
import * as execNs from '@actions/exec';
import * as globNs from '@actions/glob';
import * as httpNs from '@actions/http-client';
import * as ioNs from '@actions/io';
import * as tcNs from '@actions/tool-cache';

/*
 * The `@actions/*` packages are published as native ESM from v3 onwards.
 * Named-export bindings on an ES module namespace are read-only and
 * non-configurable, which prevents sinon from stubbing them directly.
 *
 * We therefore re-export each package as a plain object whose properties are
 * mutable and configurable, giving tests a single shared object to stub while
 * leaving the underlying packages untouched. Using `as typeof X` preserves the
 * original types so consumers get the same API surface as the upstream import.
 */

export const core = { ...coreNs, platform: { ...coreNs.platform } } as typeof coreNs;
export const exec = { ...execNs } as typeof execNs;
export const glob = { ...globNs } as typeof globNs;
export const http = { ...httpNs } as typeof httpNs;
export const io = { ...ioNs } as typeof ioNs;
export const tc = { ...tcNs } as typeof tcNs;
