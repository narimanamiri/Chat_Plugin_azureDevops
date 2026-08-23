class GitRestClient {
  async getRepositories() { return []; }
  async getCommit() { return undefined; }
  async getPullRequestById() { return undefined; }
}
module.exports = { GitRestClient };
