require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

app.post("/exchange-token", async (req, res) => {
  const { code } = req.body;

  try {
    const response = await axios.post(
      "https://api.pinterest.com/v5/oauth/token",
      {
        grant_type: "authorization_code",
        code: code,
        redirect_uri: process.env.REDIRECT_URI,
      },
      {
        auth: {
          username: process.env.CLIENT_ID,
          password: process.env.CLIENT_SECRET,
        },
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    res.json(response.data);

  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: "Token exchange failed" });
  }
});

app.listen(5000, () => {
  console.log("Server running on port 5000");
});
