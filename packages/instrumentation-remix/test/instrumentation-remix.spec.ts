import "mocha";
import * as React from "react";
import expect from "expect";
import { RemixInstrumentation } from "../src";
import { SemanticAttributes } from "@opentelemetry/semantic-conventions";
import { getTestSpans } from "opentelemetry-instrumentation-testing-utils";

const instrumentation = new RemixInstrumentation({
  actionFormDataAttributes: {
    _action: "actionType",
    foo: false,
    num: true,
  },
});

import { installGlobals } from "@remix-run/node";

import * as remixServerRuntime from "@remix-run/server-runtime";
import type { ServerBuild, ServerEntryModule } from "@remix-run/server-runtime/build";

/** REMIX SERVER BUILD */

const routes: ServerBuild["routes"] = {
  "routes/parent": {
    id: "routes/parent",
    path: "/parent",
    module: {
      loader: () => "LOADER",
      action: () => "ACTION",
      default: () => React.createElement("div", {}, "routes/parent"),
    },
  },
  "routes/parent/child/$id": {
    id: "routes/parent/child/$id",
    parentId: "routes/parent",
    path: "/parent/child/:id",
    module: {
      loader: () => "LOADER",
      action: () => "ACTION",
      default: () => React.createElement("div", {}, "routes/parent/child/$id"),
    },
  },
  "routes/throws-error": {
    id: "routes/throws-error",
    path: "/throws-error",
    module: {
      loader: async () => {
        throw new Error("oh no loader");
      },
      action: async () => {
        throw new Error("oh no action");
      },
      default: undefined,
    },
  },
};

const entryModule: ServerEntryModule = {
  default: (request, responseStatusCode, responseHeaders, context) => {
    if (new URL(request.url).search.includes("throwEntryModuleError")) {
      throw new Error("oh no entry module");
    }
    return new Response(undefined, { status: responseStatusCode, headers: responseHeaders });
  },
};

let build: ServerBuild = {
  routes,
  assets: {
    routes,
  },
  entry: {
    module: entryModule,
  },
} as unknown as ServerBuild;

/** TESTS */

describe("instrumentation-remix", () => {
  let requestHandler: remixServerRuntime.RequestHandler;
  let consoleErrorImpl;
  before(() => {
    installGlobals();
    instrumentation.enable();
    requestHandler = remixServerRuntime.createRequestHandler(build, {});
    consoleErrorImpl = console.error;
    console.error = () => {};
  });

  after(() => {
    instrumentation.disable();
    console.error = consoleErrorImpl;
  });

  describe("requestHandler", () => {
    it("handles thrown error from entry module", (done) => {
      const request = new Request("http://localhost/parent?throwEntryModuleError", { method: "GET" });
      requestHandler(request, {})
        .then(() => {
          const spans = getTestSpans();
          expect(spans.length).toBe(2);

          const [loaderSpan, requestHandlerSpan] = spans;

          //
          // Loader span
          //

          // General properties
          expect(loaderSpan.name).toBe("LOADER routes/parent");

          // Request attributes
          expect(loaderSpan.attributes[SemanticAttributes.HTTP_METHOD]).toBe("GET");
          expect(loaderSpan.attributes[SemanticAttributes.HTTP_URL]).toBe(
            "http://localhost/parent?throwEntryModuleError"
          );

          // Match attributes
          expect(loaderSpan.attributes["match.pathname"]).toBe("/parent");
          expect(loaderSpan.attributes["match.route.id"]).toBe("routes/parent");
          expect(loaderSpan.attributes["match.route.path"]).toBe("/parent");

          // Response attributes
          expect(loaderSpan.attributes[SemanticAttributes.HTTP_STATUS_CODE]).toBe(200);

          // Error attributes
          expect(loaderSpan.attributes["error"]).toBeUndefined();

          //
          // Request Handler span
          //

          // General properties
          expect(requestHandlerSpan.name).toBe("remix.request");

          // Request attributes
          expect(requestHandlerSpan.attributes[SemanticAttributes.HTTP_METHOD]).toBe("GET");
          expect(requestHandlerSpan.attributes[SemanticAttributes.HTTP_URL]).toBe(
            "http://localhost/parent?throwEntryModuleError"
          );

          // Response attributes
          expect(requestHandlerSpan.attributes[SemanticAttributes.HTTP_STATUS_CODE]).toBe(500);

          // Error attributes
          expect(requestHandlerSpan.attributes["error"]).toBeUndefined();
        })
        .catch((error) => {
          done(error);
        })
        .finally(done);
    });
  });

  describe("loaders", () => {
    it("handles basic loader", (done) => {
      const request = new Request("http://localhost/parent", { method: "GET" });
      requestHandler(request, {})
        .then(() => {
          const spans = getTestSpans();
          expect(spans.length).toBe(2);

          const [loaderSpan, requestHandlerSpan] = spans;

          //
          // Loader span
          //

          // General properties
          expect(loaderSpan.name).toBe("LOADER routes/parent");

          // Request attributes
          expect(loaderSpan.attributes[SemanticAttributes.HTTP_METHOD]).toBe("GET");
          expect(loaderSpan.attributes[SemanticAttributes.HTTP_URL]).toBe("http://localhost/parent");

          // Match attributes
          expect(loaderSpan.attributes["match.pathname"]).toBe("/parent");
          expect(loaderSpan.attributes["match.route.id"]).toBe("routes/parent");
          expect(loaderSpan.attributes["match.route.path"]).toBe("/parent");

          // Response attributes
          expect(loaderSpan.attributes[SemanticAttributes.HTTP_STATUS_CODE]).toBe(200);

          // Error attributes
          expect(loaderSpan.attributes["error"]).toBeUndefined();

          //
          // Request Handler span
          //

          // General properties
          expect(requestHandlerSpan.name).toBe("remix.request");

          // Request attributes
          expect(requestHandlerSpan.attributes[SemanticAttributes.HTTP_METHOD]).toBe("GET");
          expect(requestHandlerSpan.attributes[SemanticAttributes.HTTP_URL]).toBe("http://localhost/parent");

          // Response attributes
          expect(requestHandlerSpan.attributes[SemanticAttributes.HTTP_STATUS_CODE]).toBe(200);

          // Error attributes
          expect(requestHandlerSpan.attributes["error"]).toBeUndefined();
        })
        .catch((error) => {
          done(error);
        })
        .finally(done);
    });

    it("handles parent-child loaders", (done) => {
      const request = new Request("http://localhost/parent/child/123", { method: "GET" });
      requestHandler(request, {})
        .then(() => {
          const spans = getTestSpans();
          expect(spans.length).toBe(3);

          const [parentSpan, childSpan, requestHandlerSpan] = spans;

          //
          // Parent span
          //

          // General properties
          expect(parentSpan.name).toBe("LOADER routes/parent");

          // Request attributes
          expect(parentSpan.attributes[SemanticAttributes.HTTP_METHOD]).toBe("GET");
          expect(parentSpan.attributes[SemanticAttributes.HTTP_URL]).toBe("http://localhost/parent/child/123");

          // Match attributes
          expect(parentSpan.attributes["match.pathname"]).toBe("/parent");
          expect(parentSpan.attributes["match.route.id"]).toBe("routes/parent");
          expect(parentSpan.attributes["match.route.path"]).toBe("/parent");
          expect(parentSpan.attributes["match.params.id"]).toBe("123");

          // Response attributes
          expect(parentSpan.attributes[SemanticAttributes.HTTP_STATUS_CODE]).toBe(200);

          // Error attributes
          expect(parentSpan.attributes["error"]).toBeUndefined();

          //
          // Child span
          //

          // General properties
          expect(childSpan.name).toBe("LOADER routes/parent/child/$id");

          // Request attributes
          expect(childSpan.attributes[SemanticAttributes.HTTP_METHOD]).toBe("GET");
          expect(childSpan.attributes[SemanticAttributes.HTTP_URL]).toBe("http://localhost/parent/child/123");

          // Match attributes
          expect(childSpan.attributes["match.pathname"]).toBe("/parent/child/123");
          expect(childSpan.attributes["match.route.id"]).toBe("routes/parent/child/$id");
          expect(childSpan.attributes["match.route.path"]).toBe("/parent/child/:id");
          expect(childSpan.attributes["match.params.id"]).toBe("123");

          // Response attributes
          expect(childSpan.attributes[SemanticAttributes.HTTP_STATUS_CODE]).toBe(200);

          // Error attributes
          expect(childSpan.attributes["error"]).toBeUndefined();

          //
          // Request Handler span
          //

          // General properties
          expect(requestHandlerSpan.name).toBe("remix.request");

          // Request attributes
          expect(requestHandlerSpan.attributes[SemanticAttributes.HTTP_METHOD]).toBe("GET");
          expect(requestHandlerSpan.attributes[SemanticAttributes.HTTP_URL]).toBe("http://localhost/parent/child/123");

          // Response attributes
          expect(requestHandlerSpan.attributes[SemanticAttributes.HTTP_STATUS_CODE]).toBe(200);

          // Error attributes
          expect(requestHandlerSpan.attributes["error"]).toBeUndefined();
        })
        .catch((error) => {
          done(error);
        })
        .finally(done);
    });

    it("handles a thrown error from loader", (done) => {
      const request = new Request("http://localhost/throws-error", { method: "GET" });
      requestHandler(request, {})
        .then(() => {
          const spans = getTestSpans();
          expect(spans.length).toBe(2);

          const [loaderSpan, requestHandlerSpan] = spans;

          //
          // Loader span
          //

          // General properties
          expect(loaderSpan.name).toBe("LOADER routes/throws-error");

          // Request attributes
          expect(loaderSpan.attributes[SemanticAttributes.HTTP_METHOD]).toBe("GET");
          expect(loaderSpan.attributes[SemanticAttributes.HTTP_URL]).toBe("http://localhost/throws-error");

          // Match attributes
          expect(loaderSpan.attributes["match.pathname"]).toBe("/throws-error");
          expect(loaderSpan.attributes["match.route.id"]).toBe("routes/throws-error");
          expect(loaderSpan.attributes["match.route.path"]).toBe("/throws-error");

          // Response attributes
          expect(loaderSpan.attributes[SemanticAttributes.HTTP_STATUS_CODE]).toBeUndefined();

          // Error attributes
          expect(loaderSpan.attributes["error"]).toBe(true);
          expect(loaderSpan.attributes[SemanticAttributes.EXCEPTION_MESSAGE]).toBe("oh no loader");
          expect(loaderSpan.attributes[SemanticAttributes.EXCEPTION_STACKTRACE]).toBeDefined();

          //
          // Request Handler span
          //

          // General properties
          expect(requestHandlerSpan.name).toBe("remix.request");

          // Request attributes
          expect(requestHandlerSpan.attributes[SemanticAttributes.HTTP_METHOD]).toBe("GET");
          expect(requestHandlerSpan.attributes[SemanticAttributes.HTTP_URL]).toBe("http://localhost/throws-error");

          // Response attributes
          expect(requestHandlerSpan.attributes[SemanticAttributes.HTTP_STATUS_CODE]).toBe(500);

          // Error attributes
          expect(requestHandlerSpan.attributes["error"]).toBeUndefined();
        })
        .catch((error) => {
          done(error);
        })
        .finally(done);
    });
  });

  describe("actions", () => {
    it("handles basic action", (done) => {
      const request = new Request("http://localhost/parent", { method: "POST" });
      requestHandler(request, {})
        .then(() => {
          const spans = getTestSpans();
          expect(spans.length).toBe(3);

          const [actionSpan, loaderSpan, requestHandlerSpan] = spans;

          //
          // Action span
          //

          // General properties
          expect(actionSpan.name).toBe("ACTION routes/parent");

          // Request attributes
          expect(actionSpan.attributes[SemanticAttributes.HTTP_METHOD]).toBe("POST");
          expect(actionSpan.attributes[SemanticAttributes.HTTP_URL]).toBe("http://localhost/parent");

          // Match attributes
          expect(actionSpan.attributes["match.pathname"]).toBe("/parent");
          expect(actionSpan.attributes["match.route.id"]).toBe("routes/parent");
          expect(actionSpan.attributes["match.route.path"]).toBe("/parent");

          // Response attributes
          expect(actionSpan.attributes[SemanticAttributes.HTTP_STATUS_CODE]).toBe(200);

          // Error attributes
          expect(actionSpan.attributes["error"]).toBeUndefined();
          expect(actionSpan.attributes[SemanticAttributes.EXCEPTION_MESSAGE]).toBeUndefined();
          expect(actionSpan.attributes[SemanticAttributes.EXCEPTION_STACKTRACE]).toBeUndefined();

          //
          // Loader span
          //

          // General properties
          expect(loaderSpan.name).toBe("LOADER routes/parent");

          // Request attributes
          expect(loaderSpan.attributes[SemanticAttributes.HTTP_METHOD]).toBe("POST");
          expect(loaderSpan.attributes[SemanticAttributes.HTTP_URL]).toBe("http://localhost/parent");

          // Match attributes
          expect(loaderSpan.attributes["match.pathname"]).toBe("/parent");
          expect(loaderSpan.attributes["match.route.id"]).toBe("routes/parent");
          expect(loaderSpan.attributes["match.route.path"]).toBe("/parent");

          // Response attributes
          expect(loaderSpan.attributes[SemanticAttributes.HTTP_STATUS_CODE]).toBe(200);

          // Error attributes
          expect(loaderSpan.attributes["error"]).toBeUndefined();
          expect(loaderSpan.attributes[SemanticAttributes.EXCEPTION_MESSAGE]).toBeUndefined();
          expect(loaderSpan.attributes[SemanticAttributes.EXCEPTION_STACKTRACE]).toBeUndefined();

          //
          // Request Handler span
          //

          // General properties
          expect(requestHandlerSpan.name).toBe("remix.request");

          // Request attributes
          expect(requestHandlerSpan.attributes[SemanticAttributes.HTTP_METHOD]).toBe("POST");
          expect(requestHandlerSpan.attributes[SemanticAttributes.HTTP_URL]).toBe("http://localhost/parent");

          // Response attributes
          expect(requestHandlerSpan.attributes[SemanticAttributes.HTTP_STATUS_CODE]).toBe(200);

          // Error attributes
          expect(requestHandlerSpan.attributes["error"]).toBeUndefined();
        })
        .catch((error) => {
          done(error);
        })
        .finally(done);
    });

    it("extracts action formData fields from form data", (done) => {
      const body = new FormData();
      body.append("_action", "myAction");
      body.append("foo", "bar");
      body.append("num", "123");
      const request = new Request("http://localhost/parent", {
        method: "POST",
        body,
      });

      requestHandler(request, {})
        .then(() => {
          const spans = getTestSpans();
          expect(spans.length).toBe(3);

          const [actionSpan, loaderSpan, requestHandlerSpan] = spans;

          //
          // Action span
          //

          // General properties
          expect(actionSpan.name).toBe("ACTION routes/parent");

          // Form attributes
          expect(actionSpan.attributes["formData.actionType"]).toBe("myAction");
          expect(actionSpan.attributes["formData.foo"]).toBeUndefined();
          expect(actionSpan.attributes["formData.num"]).toBe("123");

          // Request attributes
          expect(actionSpan.attributes[SemanticAttributes.HTTP_METHOD]).toBe("POST");
          expect(actionSpan.attributes[SemanticAttributes.HTTP_URL]).toBe("http://localhost/parent");

          // Match attributes
          expect(actionSpan.attributes["match.pathname"]).toBe("/parent");
          expect(actionSpan.attributes["match.route.id"]).toBe("routes/parent");
          expect(actionSpan.attributes["match.route.path"]).toBe("/parent");

          // Response attributes
          expect(actionSpan.attributes[SemanticAttributes.HTTP_STATUS_CODE]).toBe(200);

          // Error attributes
          expect(actionSpan.attributes["error"]).toBeUndefined();
          expect(actionSpan.attributes[SemanticAttributes.EXCEPTION_MESSAGE]).toBeUndefined();
          expect(actionSpan.attributes[SemanticAttributes.EXCEPTION_STACKTRACE]).toBeUndefined();

          //
          // Loader span
          //

          // General properties
          expect(loaderSpan.name).toBe("LOADER routes/parent");

          // Request attributes
          expect(loaderSpan.attributes[SemanticAttributes.HTTP_METHOD]).toBe("POST");
          expect(loaderSpan.attributes[SemanticAttributes.HTTP_URL]).toBe("http://localhost/parent");

          // Match attributes
          expect(loaderSpan.attributes["match.pathname"]).toBe("/parent");
          expect(loaderSpan.attributes["match.route.id"]).toBe("routes/parent");
          expect(loaderSpan.attributes["match.route.path"]).toBe("/parent");

          // Response attributes
          expect(loaderSpan.attributes[SemanticAttributes.HTTP_STATUS_CODE]).toBe(200);

          // Error attributes
          expect(loaderSpan.attributes["error"]).toBeUndefined();
          expect(loaderSpan.attributes[SemanticAttributes.EXCEPTION_MESSAGE]).toBeUndefined();
          expect(loaderSpan.attributes[SemanticAttributes.EXCEPTION_STACKTRACE]).toBeUndefined();

          //
          // Request Handler span
          //

          // General properties
          expect(requestHandlerSpan.name).toBe("remix.request");

          // Request attributes
          expect(requestHandlerSpan.attributes[SemanticAttributes.HTTP_METHOD]).toBe("POST");
          expect(requestHandlerSpan.attributes[SemanticAttributes.HTTP_URL]).toBe("http://localhost/parent");

          // Response attributes
          expect(requestHandlerSpan.attributes[SemanticAttributes.HTTP_STATUS_CODE]).toBe(200);

          // Error attributes
          expect(requestHandlerSpan.attributes["error"]).toBeUndefined();
        })
        .catch((error) => {
          done(error);
        })
        .finally(done);
    });

    it("handles a thrown error from action", (done) => {
      const request = new Request("http://localhost/throws-error", { method: "POST" });
      requestHandler(request, {})
        .then(() => {
          const spans = getTestSpans();
          expect(spans.length).toBe(2);

          const [actionSpan, requestHandlerSpan] = spans;

          //
          // Action span
          //

          // General properties
          expect(actionSpan.name).toBe("ACTION routes/throws-error");

          // Request attributes
          expect(actionSpan.attributes[SemanticAttributes.HTTP_METHOD]).toBe("POST");
          expect(actionSpan.attributes[SemanticAttributes.HTTP_URL]).toBe("http://localhost/throws-error");

          // Match attributes
          expect(actionSpan.attributes["match.pathname"]).toBe("/throws-error");
          expect(actionSpan.attributes["match.route.id"]).toBe("routes/throws-error");
          expect(actionSpan.attributes["match.route.path"]).toBe("/throws-error");

          // Response attributes
          expect(actionSpan.attributes[SemanticAttributes.HTTP_STATUS_CODE]).toBeUndefined();

          // Error attributes
          expect(actionSpan.attributes["error"]).toBe(true);
          expect(actionSpan.attributes[SemanticAttributes.EXCEPTION_MESSAGE]).toBe("oh no action");
          expect(actionSpan.attributes[SemanticAttributes.EXCEPTION_STACKTRACE]).toBeDefined();

          //
          // Request Handler span
          //

          // General properties
          expect(requestHandlerSpan.name).toBe("remix.request");

          // Request attributes
          expect(requestHandlerSpan.attributes[SemanticAttributes.HTTP_METHOD]).toBe("POST");
          expect(requestHandlerSpan.attributes[SemanticAttributes.HTTP_URL]).toBe("http://localhost/throws-error");

          // Response attributes
          expect(requestHandlerSpan.attributes[SemanticAttributes.HTTP_STATUS_CODE]).toBe(500);

          // Error attributes
          expect(requestHandlerSpan.attributes["error"]).toBeUndefined();
        })
        .catch((error) => {
          done(error);
        })
        .finally(done);
    });
  });
});
