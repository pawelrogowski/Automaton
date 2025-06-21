const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const CompressionPlugin = require('compression-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

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
    new HtmlWebpackPlugin({
      template: './frontend/index.html',
    }),
    new CopyWebpackPlugin({
      patterns: [
        // Existing patterns...
        {
          from: 'node_modules/monaco-editor/min/vs',
          to: 'monaco-editor/min/vs',
        },
        // New pattern to copy preprocessed minimap resources
        {
          from: 'resources/preprocessed_minimaps',
          to: 'resources/preprocessed_minimaps',
        },
      ],
    }),
    new HtmlWebpackPlugin({
      template: './frontend/scriptEditor.html',
      filename: 'scriptEditor.html', // Output script editor html to dist
      inject: false, // Prevent webpack from injecting bundles automatically
    }),
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
