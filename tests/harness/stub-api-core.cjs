const { state } = require("./index.cjs");
class CoreRestClient {
  async getAllTeams() { return state.teams.map((t) => ({ ...t })); }
  async getProjects() { return state.projects.map((p) => ({ ...p })); }
  async getTeams(projectId) { return state.teams.filter((t) => t.projectId === projectId); }
  async getTeamMembersWithExtendedProperties(_projectId, teamId) {
    return state.teamMembers.get(teamId) ?? [];
  }
}
module.exports = { CoreRestClient };
