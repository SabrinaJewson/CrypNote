"use strict";

module.exports = {
	env: {
		es2020: true,
		node: true,
	},
	parserOptions: {
		ecmaVersion: 11,
		ecmaFeatures: {
			jsx: true,
		},
		sourceType: "script",
	},
	extends: "eslint:recommended",
	rules: {
		"func-style": ["error", "declaration", { allowArrowFunctions: true }],
		"max-statements-per-line": ["warn", { "max": 2 }],
		"new-cap": ["error"],
		"new-parens": ["error"],
		"no-implicit-coercion": ["warn"],
		"no-mixed-spaces-and-tabs": "off",
		"no-multi-assign": ["error"],
		"no-plusplus": ["error"],
		"no-throw-literal": ["warn"],
		"no-unused-vars": "off",
		"no-var": ["warn"],
		"prefer-arrow-callback": ["error", { allowUnboundThis: false }],
		"prefer-const": ["warn"],
		"prefer-rest-params": ["error"],
		"sort-imports": ["warn", { allowSeparatedGroups: true }],
		curly: ["warn", "all"],
		eqeqeq: ["error", "always"],
		strict: ["error", "global"],
	},
	ignorePatterns: ["node_modules", "dist"],
	overrides: [
		{
			files: ["src/**/*.ts", "src/**/*.tsx"],
			env: {
				node: false,
				browser: true,
			},
			parserOptions: {
				sourceType: "module",
			},
		},
		{
			files: ["src/**/*.ts", "src/**/*.tsx"],
			parser: "@typescript-eslint/parser",
			parserOptions: {
				tsconfigRootDir: __dirname,
				project: ["./tsconfig.json"],
			},
			extends: [
				"plugin:@typescript-eslint/recommended",
				"plugin:@typescript-eslint/recommended-requiring-type-checking",
			],
			rules: {
				"@typescript-eslint/explicit-function-return-type": ["warn", { allowExpressions: true }],
				"@typescript-eslint/no-inferrable-types": ["warn", { ignoreParameters: true }],
				"@typescript-eslint/no-namespace": "off",
				"@typescript-eslint/no-non-null-assertion": "off",
				"@typescript-eslint/no-unused-vars": ["warn", { varsIgnorePattern: "^_", argsIgnorePattern: "^_" }],
				"react/jsx-uses-vars": 2,
			},
			plugins: ["@typescript-eslint", "react"],
		},
	],
};
