const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
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

    // KEPT: This is CRITICAL for your non-React scriptEditor.html window.
    // It copies the pre-built Monaco files to your output directory.
    new CopyWebpackPlugin({
      patterns: [
        {
          from: 'resources/preprocessed_minimaps',
          to: 'resources/preprocessed_minimaps',
        },
      ],
    }),

    // REMOVED: This plugin was only for bundling Monaco within the React app.
    // The CopyWebpackPlugin above handles the non-React case.
    /*
    new MonacoWebpackPlugin({
      languages: ['lua'],
      publicPath: './',
    }),
    */
  ],
  optimization: {
    minimize: false,
  },
};
