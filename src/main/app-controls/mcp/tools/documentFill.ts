import { z } from "zod";
import { requireProject, type ToolDomain } from "./types";

const fillArgsSchema = z.object({
  projectId: z.string().min(1).optional(),
  templatePath: z.string().min(1),
  rulesPath: z.string().min(1),
  configPath: z.string().min(1),
  projectPath: z.string().min(1),
  outputPath: z.string().min(1),
});

/**
 * Render a fixed OOXML template (bundled GJB 438C SRS/SDD/IDA) from filled
 * `config.json`/`project.json` and write the `.docx` into the project.
 *
 * Runs entirely inside AgentEmployee's Node runtime — no external interpreter and no
 * network — so it works in offline/air-gapped installs. The template and
 * `rules.json` come from the skill's own directory (read-only resources);
 * `configPath`, `projectPath`, and `outputPath` are project-relative.
 */
export const documentFillTools: ToolDomain = {
  specs: [
    {
      name: "fill_document_template",
      description:
        "Fill a fixed OOXML (.docx) document template from filled config.json/project.json and write the result into the project. Use this instead of running an external script. Pass the template and rules.json paths from the skill directory, and project-relative config/project/output paths. Returns the written output path.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["templatePath", "rulesPath", "configPath", "projectPath", "outputPath"],
        properties: {
          projectId: { type: "string" },
          templatePath: { type: "string", minLength: 1 },
          rulesPath: { type: "string", minLength: 1 },
          configPath: { type: "string", minLength: 1 },
          projectPath: { type: "string", minLength: 1 },
          outputPath: { type: "string", minLength: 1 },
        },
      },
    },
  ],
  handlers: {
    fill_document_template: async (args, ctx) => {
      const parsed = fillArgsSchema.parse(args);
      const threadId = ctx.identity.threadId;
      const projectId =
        parsed.projectId ?? (threadId ? ctx.getThread(threadId)?.projectId : undefined);
      if (!projectId) {
        throw new Error("无法确定工程：请传入 projectId，或从工程内的对话调用。");
      }
      const project = requireProject(ctx, projectId);
      const result = await ctx.supervisor.fillDocumentTemplate({
        projectLocation: project.location,
        templatePath: parsed.templatePath,
        rulesPath: parsed.rulesPath,
        configPath: parsed.configPath,
        projectPath: parsed.projectPath,
        outputPath: parsed.outputPath,
      });
      console.log(
        `[app-controls] fill_document_template -> ${result.outputPath} (project ${projectId})`,
      );
      return { written: true, outputPath: result.outputPath };
    },
  },
};
