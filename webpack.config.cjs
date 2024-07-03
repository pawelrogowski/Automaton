const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const WebpackObfuscator = require('webpack-obfuscator');

module.exports = {
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
  },
  devtool: 'source-map',
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
              publicPath: 'images/',
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
              publicPath: 'images/',
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
              publicPath: 'images/',
            },
          },
        ],
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/index.html',
    }),
    new CopyWebpackPlugin({
      patterns: [{ from: 'src/assets', to: 'dist/assets' }],
    }),
    new WebpackObfuscator(
      {
        rotateStringArray: true,
        stringArray: true,
        stringArrayEncoding: ['base64'],
        deadCodeInjection: true,
        identifierNamesGenerator: 'hexadecimal',
        selfDefending: true,
        transformObjectKeys: true,
      },
      ['electron/main.js'],
    ), // Exclude main.js from obfuscation
  ],
};
