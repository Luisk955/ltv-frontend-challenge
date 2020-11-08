'use strict';

const webpack = require('webpack');
const config = require('./config.js');
const autoprefixer = require('autoprefixer');
const AssetsPlugin = require('assets-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const WebpackNotifierPlugin = require('webpack-notifier');
const CleanWebpackPlugin = require('clean-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const FriendlyErrorsPlugin = require('friendly-errors-webpack-plugin');
const OptimizeCSSAssetsPlugin = require('optimize-css-assets-webpack-plugin');

const DEV = process.env.NODE_ENV === 'development';

module.exports = {
  bail: !DEV,
  mode: DEV ? 'development' : 'production',
  // We generate sourcemaps in production. This is slow but gives good results.
  // You can exclude the *.map files from the build during deployment.
  target: 'web',
  devtool: !DEV ? 'source-map' : 'cheap-eval-source-map',
  entry: config.entries,
  output: {
    filename: '[name].js',
    path: config.paths.build,
  },
  resolve: {
    modules: [config.paths.src + '/js', config.paths.nodeModules],
  },
  module: {
    rules: [
      // Disable require.ensure as it's not a standard language feature.
      { parser: { requireEnsure: false } },
      // Transform ES6 with Babel
      {
        test: /\.js?$/,
        loader: 'babel-loader',
        include: config.paths.src,
      },
      {
        test: /\.scss$/,
        use: [
          MiniCssExtractPlugin.loader,
          {
            loader: 'css-loader',
          },
          {
            loader: 'postcss-loader',
            options: {
              ident: 'postcss', // https://webpack.js.org/guides/migrating/#complex-options
              plugins: () => [autoprefixer()],
            },
          },
          {
            loader: 'sass-loader',
          },
        ],
      },
      {
        test: /\.woff?$/,
        use: [
          {
            loader: 'url-loader',
            options: {
              limit: false,
              esModule: false,
            },
          },
        ],
      },
    ],
  },
  optimization: {
    minimize: !DEV,
    minimizer: [
      new OptimizeCSSAssetsPlugin({
        cssProcessorOptions: {
          map: {
            inline: false,
            annotation: true,
          },
        },
      }),
      new TerserPlugin({
        terserOptions: {
          extractComments: true,
          compress: {
            warnings: false,
          },
          output: {
            comments: false,
          },
        },
        sourceMap: true,
      }),
    ],
  },
  plugins: [
    new OptimizeCSSAssetsPlugin({
      cssProcessorPluginOptions: {
        preset: ['default', { discardComments: { removeAll: true } }],
      },
    }),
    new CleanWebpackPlugin(['build']),
    new WebpackNotifierPlugin({
      title: 'Beenverified Test',
    }),
    new MiniCssExtractPlugin({
      filename: '[name].css',
    }),
    new webpack.EnvironmentPlugin({
      NODE_ENV: 'development', // use 'development' unless process.env.NODE_ENV is defined
      DEBUG: false,
    }),
    new AssetsPlugin({
      path: config.paths.build,
      filename: 'assets.json',
    }),
    new CopyPlugin([
      {
        from: config.paths.src + '/images',
        to: config.paths.build + '/images',
      },
      { from: config.paths.src + '/fonts', to: config.paths.build + '/fonts' },
    ]),
    DEV &&
      new FriendlyErrorsPlugin({
        clearConsole: false,
      }),
  ].filter(Boolean),
};
