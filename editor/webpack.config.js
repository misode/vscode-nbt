module.exports = (env, argv) => ({
  entry: './src/Editor.ts',
  output: {
    path: __dirname + '/out',
    filename: 'editor.js'
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      { test: /\.ts$/, loader: 'ts-loader' }
    ]
  }
})
