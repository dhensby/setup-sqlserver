import { core } from './actions.ts';
import install from './install.ts';

(() => install().catch((e) => {
    core.setFailed(e as Error);
}))();
