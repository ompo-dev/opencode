import { describe, expect, test } from "bun:test"
import path from "path"
import { Global } from "../../src/global"
import { checkPluginPolicy, parsePluginSpecifier, pluginStorage, resolveMarketplaceSpec } from "../../src/plugin/shared"

describe("parsePluginSpecifier", () => {
  test("parses standard npm package without version", () => {
    expect(parsePluginSpecifier("acme")).toEqual({
      pkg: "acme",
      version: "latest",
    })
  })

  test("parses standard npm package with version", () => {
    expect(parsePluginSpecifier("acme@1.0.0")).toEqual({
      pkg: "acme",
      version: "1.0.0",
    })
  })

  test("parses scoped npm package without version", () => {
    expect(parsePluginSpecifier("@opencode/acme")).toEqual({
      pkg: "@opencode/acme",
      version: "latest",
    })
  })

  test("parses scoped npm package with version", () => {
    expect(parsePluginSpecifier("@opencode/acme@1.0.0")).toEqual({
      pkg: "@opencode/acme",
      version: "1.0.0",
    })
  })

  test("parses package with git+https url", () => {
    expect(parsePluginSpecifier("acme@git+https://github.com/opencode/acme.git")).toEqual({
      pkg: "acme",
      version: "git+https://github.com/opencode/acme.git",
    })
  })

  test("parses scoped package with git+https url", () => {
    expect(parsePluginSpecifier("@opencode/acme@git+https://github.com/opencode/acme.git")).toEqual({
      pkg: "@opencode/acme",
      version: "git+https://github.com/opencode/acme.git",
    })
  })

  test("parses package with git+ssh url containing another @", () => {
    expect(parsePluginSpecifier("acme@git+ssh://git@github.com/opencode/acme.git")).toEqual({
      pkg: "acme",
      version: "git+ssh://git@github.com/opencode/acme.git",
    })
  })

  test("parses scoped package with git+ssh url containing another @", () => {
    expect(parsePluginSpecifier("@opencode/acme@git+ssh://git@github.com/opencode/acme.git")).toEqual({
      pkg: "@opencode/acme",
      version: "git+ssh://git@github.com/opencode/acme.git",
    })
  })

  test("parses unaliased git+ssh url", () => {
    expect(parsePluginSpecifier("git+ssh://git@github.com/opencode/acme.git")).toEqual({
      pkg: "git+ssh://git@github.com/opencode/acme.git",
      version: "",
    })
  })

  test("parses npm alias using the alias name", () => {
    expect(parsePluginSpecifier("acme@npm:@opencode/acme@1.0.0")).toEqual({
      pkg: "acme",
      version: "npm:@opencode/acme@1.0.0",
    })
  })

  test("parses bare npm protocol specifier using the target package", () => {
    expect(parsePluginSpecifier("npm:@opencode/acme@1.0.0")).toEqual({
      pkg: "@opencode/acme",
      version: "1.0.0",
    })
  })

  test("parses unversioned npm protocol specifier", () => {
    expect(parsePluginSpecifier("npm:@opencode/acme")).toEqual({
      pkg: "@opencode/acme",
      version: "latest",
    })
  })

  test("blocks plugin when deny rule matches package name", () => {
    expect(
      checkPluginPolicy(
        {
          deny: ["@opencode/acme"],
        },
        {
          spec: "@opencode/acme@1.0.0",
          id: "acme",
        },
      ),
    ).toMatchObject({
      ok: false,
    })
  })

  test("allows plugin during lockdown when allow rule matches id", () => {
    expect(
      checkPluginPolicy(
        {
          lockdown: true,
          allow: ["acme"],
        },
        {
          spec: "acme@1.0.0",
          id: "acme",
        },
      ),
    ).toMatchObject({
      ok: true,
    })
  })

  test("uses versioned plugin cache directory", () => {
    const out = pluginStorage("acme/plugin", {
      directory: path.join(Global.Path.cache, "custom"),
      version: "v2",
    })

    expect(out.dataDir).toBe(path.join(Global.Path.data, "plugin", "acme_plugin"))
    expect(out.cacheDir).toBe(path.join(Global.Path.cache, "custom", "v2", "acme_plugin"))
    expect(out.configDir).toBe(path.join(Global.Path.config, "plugin", "acme_plugin"))
    expect(out.stateDir).toBe(path.join(Global.Path.state, "plugin", "acme_plugin"))
  })

  test("resolves npm marketplace aliases", () => {
    expect(
      resolveMarketplaceSpec("corp:demo@1.2.3", {
        corp: {
          url: "@corp/",
          type: "npm",
        },
      }),
    ).toBe("@corp/demo@1.2.3")
  })

  test("resolves git marketplace aliases with placeholders", () => {
    expect(
      resolveMarketplaceSpec("git:demo@main", {
        git: {
          url: "https://github.com/acme/{name}.git",
          type: "git",
        },
      }),
    ).toBe("https://github.com/acme/demo.git#main")
  })

  test("resolves directory marketplace aliases", () => {
    expect(
      resolveMarketplaceSpec("local:demo", {
        local: {
          url: path.join("C:", "plugins"),
          type: "directory",
        },
      }),
    ).toBe(path.join("C:", "plugins", "demo"))
  })
})
