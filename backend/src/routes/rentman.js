const express = require("express");
const { searchProjects, loadCrew } = require("../rentman");

const router = express.Router();

function getToken(req) {
  return req.header("X-Rentman-Token") || "";
}

router.get("/projects/search", async (req, res, next) => {
  try {
    const query = String(req.query.q || "");
    const fullHistory = req.query.full === "true";
    const matches = await searchProjects(getToken(req), query, fullHistory);
    res.json({ matches });
  } catch (err) {
    next(err);
  }
});

router.get("/projects/:id/crew", async (req, res, next) => {
  try {
    const data = await loadCrew(getToken(req), req.params.id);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;