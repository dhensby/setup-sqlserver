import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: ['lib/'],
    },
    eslint.configs.recommended,
    tseslint.configs.recommended,
    {
        rules: {
            'comma-dangle': ['error', 'always-multiline'],
            'no-shadow': ['error'],
            'semi': ['error', 'always'],
        },
    },
    {
        files: ['test/**/*'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
        },
    },
);
