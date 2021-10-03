"use strict";

const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const HtmlInlineScriptPlugin = require("html-inline-script-webpack-plugin");

const production = process.env.NODE_ENV === "production";

module.exports = {
	entry: "./src/index.tsx",
	module: {
		rules: [
			{
				test: /\.tsx?$/,
				include: path.resolve(__dirname, "src"),
				loader: "babel-loader",
			},
			{
				test: /\.scss$/,
				include: path.resolve(__dirname, "src"),
				use: [
					{
						loader: "style-loader",
						options: { injectType: production ? "singletonStyleTag" : "styleTag" }
					},
					"css-loader",
					"sass-loader",
				],
			},
		],
	},
	output: {
		filename: "main.[contenthash].js",
		path: path.resolve(__dirname, "dist"),
	},
	plugins: [
		new HtmlWebpackPlugin({ inject: "body" }),
		new HtmlInlineScriptPlugin(),
	],
	watchOptions: {
		ignored: /node_modules|dist/,
	},
	resolve: {
		mainFiles: ["index"],
		extensions: [".ts", ".tsx"],
	},
	devtool: production ? false : "eval-cheap-module-source-map",
	mode: process.env.NODE_ENV,
};
