
// src/index.js
import express from 'express';
import { applyRoutes } from './emulator/express.js';
import routes from './routes/index.js';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Apply the routes
applyRoutes(app, routes);

app.listen(port, () => {
  console.log(`Lyrics+ server listening at http://localhost:${port}`);
});
