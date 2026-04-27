const { fetchSmart } = require("./fetch");
const detect = require("./detect");
const score = require("./score");

module.exports = {
  fetchSmart,
  ...detect,
  ...score,
};