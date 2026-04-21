import core from '@actions/core';
import install from './install.ts';

(() => install().catch((e) => {
    core.setFailed(e as Error);
}))();
