const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const CompressionPlugin = require('compression-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');

module.exports = {
  entry: './frontend/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
  },
  target: 'electron-renderer',
  resolve: {
    extensions: ['.js', '.jsx', '.mjs'],
    fallback: {
      fs: false,
      path: require.resolve('path-browserify'),
      process: require.resolve('process/browser'),
    },
  },
  module: {
    rules: [
      {
        test: /\.(mjs|js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
        },
      },
      {
        test: /\.node$/,
        loader: 'node-loader',
        options: {
          name: '[name].[ext]',
        },
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.svg$/,
        use: ['file-loader'],
      },
      {
        test: /\.webp$/,
        use: [
          {
            loader: 'file-loader',
            options: {
              name: '[name].[ext]',
              outputPath: 'images/',
              publicPath: './images/',
            },
          },
        ],
      },
      {
        test: /\.png$/,
        use: [
          {
            loader: 'file-loader',
            options: {
              name: '[name].[ext]',
              outputPath: 'images/',
              publicPath: './images/',
            },
          },
        ],
      },
      {
        test: /\.gif$/,
        use: [
          {
            loader: 'file-loader',
            options: {
              name: '[name].[ext]',
              outputPath: 'images/',
              publicPath: './images/',
            },
          },
        ],
      },
    ],
  },
  plugins: [
    // Generates index.html for the React app
    new HtmlWebpackPlugin({
      template: './frontend/index.html',
    }),

    // Generates scriptEditor.html for the separate window
    new HtmlWebpackPlugin({
      template: './frontend/scriptEditor.html',
      filename: 'scriptEditor.html',
      inject: false,
    }),

    // Copies static assets, including the raw Monaco files for the non-React window
    new CopyWebpackPlugin({
      patterns: [
        {
          from: 'node_modules/monaco-editor/min/vs',
          to: 'monaco-editor/min/vs',
        },
        {
          from: './frontend/scriptEditorEntry.js',
          to: 'scriptEditorEntry.js',
        },
        {
          from: './frontend/scriptEditor.css',
          to: 'scriptEditor.css',
        },
      ],
    }),

    // Bundles Monaco correctly for the React app
    new MonacoWebpackPlugin({
      languages: ['lua'],
      // --- THIS IS THE KEY ADDITION ---
      // Ensures worker files are loaded from a relative path, which is crucial for Electron's `file://` protocol.
      publicPath: './',
    }),

    // Your existing compression plugin
    new CompressionPlugin({
      algorithm: 'gzip',
      test: /\.js$|\.css$|\.html$/,
      threshold: 10240,
      minRatio: 0.8,
    }),
  ],
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          compress: {
            drop_console: false,
          },
          mangle: true,
          output: {
            comments: false,
          },
        },
      }),
    ],
  },
};
