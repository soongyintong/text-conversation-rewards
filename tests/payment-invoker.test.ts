import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Logs } from "@ubiquity-os/ubiquity-os-logger";
import type { IssueActivity } from "../src/issue-activity";
import type { ContextPlugin } from "../src/types/plugin-input";
import type { Result } from "../src/types/results";
import cfg from "./__mocks__/results/valid-configuration.json";

const isAdminMock = jest.fn();
const isCollaborativeMock = jest.fn();

jest.mock("../src/helpers/checkers", () => ({
  isAdmin: isAdminMock,
  isCollaborative: isCollaborativeMock,
}));

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(),
    rpc: jest.fn(),
  })),
}));

let PaymentModule: typeof import("../src/parser/payment-module").PaymentModule;
let GithubCommentModule: typeof import("../src/parser/github-comment-module").GithubCommentModule;

const issueAuthor = { id: 1, login: "issue-author" };
const closer = { id: 2, login: "closer" };
const repository = {
  id: 1,
  name: "conversation-rewards",
  owner: {
    login: "ubiquity-os",
    id: 76412717,
  },
};

function createContext() {
  return {
    payload: {
      issue: {
        id: 1,
        html_url: "https://github.com/ubiquity-os/conversation-rewards/issues/5",
      },
      repository,
    },
    config: {
      ...cfg,
      incentives: {
        ...cfg.incentives,
        githubComment: {
          debug: false,
          post: true,
        },
      },
    },
    logger: new Logs("debug"),
    octokit: {},
    env: {},
    commentHandler: {
      postComment: jest.fn(async () => ({ id: 123 })),
    },
    adapters: {
      supabase: {
        location: {
          upsert: jest.fn(),
        },
      },
    },
  } as unknown as ContextPlugin;
}

function createActivity() {
  return {
    self: {
      user: issueAuthor,
      closed_by: closer,
    },
    comments: [],
    events: [],
    linkedMergedPullRequests: [],
    linkedIssues: [],
  } as unknown as Readonly<IssueActivity>;
}

const result: Result = {
  contributor: {
    total: 0,
    userId: 3,
  },
};

beforeAll(async () => {
  ({ PaymentModule } = await import("../src/parser/payment-module"));
  ({ GithubCommentModule } = await import("../src/parser/github-comment-module"));
});

beforeEach(() => {
  jest.clearAllMocks();
  isCollaborativeMock.mockReturnValue(false);
});

describe("reward generation invoker checks", () => {
  it("checks admin status against the user who closed the issue before generating payment", async () => {
    isAdminMock.mockResolvedValue(true as never);

    const paymentModule = new PaymentModule(createContext());
    const canMakePayment = await paymentModule._canMakePayment(createActivity());

    expect(canMakePayment).toBe(true);
    expect(isAdminMock).toHaveBeenCalledWith("closer", expect.any(Object));
    expect(isAdminMock).not.toHaveBeenCalledWith("issue-author", expect.any(Object));
  });

  it("posts reward output for admin closers even when the issue author is not the invoker", async () => {
    isAdminMock.mockResolvedValue(true as never);
    const context = createContext();
    const githubCommentModule = new GithubCommentModule(context);

    await githubCommentModule.transform(createActivity(), result);

    expect(context.commentHandler.postComment).toHaveBeenCalledTimes(1);
    expect(isAdminMock).toHaveBeenCalledWith("closer", expect.any(Object));
    expect(isAdminMock).not.toHaveBeenCalledWith("issue-author", expect.any(Object));
  });

  it("blocks reward output when a non-admin closer completes a non-collaborative issue", async () => {
    isAdminMock.mockResolvedValue(false as never);
    const context = createContext();
    const githubCommentModule = new GithubCommentModule(context);

    await githubCommentModule.transform(createActivity(), result);

    expect(context.commentHandler.postComment).toHaveBeenCalledTimes(1);
    expect(context.commentHandler.postComment).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        logMessage: expect.objectContaining({
          raw: "Issue is non-collaborative. Skipping permit generation.",
        }),
      })
    );
    expect(isAdminMock).toHaveBeenCalledWith("closer", expect.any(Object));
  });
});
