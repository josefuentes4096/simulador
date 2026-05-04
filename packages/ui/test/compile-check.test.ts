import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { SimulationModel } from '@simulador/shared';
import { toCpp, toJava, toGo } from '../src/export/sourceCode';

const EXAMPLE = path.resolve(
  __dirname,
  '../../../example-resolutions/Ejercicio 1 - 1 Cola.json',
);
const model = JSON.parse(readFileSync(EXAMPLE, 'utf8')) as SimulationModel;

const OUT = path.join(tmpdir(), `simulador-compile-${Date.now()}`);
mkdirSync(OUT, { recursive: true });

describe('source code emitters compile', () => {
  it('writes outputs and reports tool versions', () => {
    writeFileSync(path.join(OUT, 'sim.cpp'), toCpp(model));
    writeFileSync(path.join(OUT, 'Simulation.java'), toJava(model));
    writeFileSync(path.join(OUT, 'sim.go'), toGo(model));
    console.log('Output dir:', OUT);
    expect(true).toBe(true);
  });

  it('Java: javac compiles', () => {
    try {
      const out = execSync(`javac -d "${OUT}" "${path.join(OUT, 'Simulation.java')}"`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      console.log('javac OK', out);
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message: string };
      console.error('javac FAILED:\n', err.stderr ?? err.message);
      throw e;
    }
  });

  it('Go: go build compiles', () => {
    // Go needs the file in a module. Init one in OUT.
    try {
      execSync('go mod init simtest', { cwd: OUT, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      // already initialized
    }
    try {
      const out = execSync(`go build -o sim sim.go`, {
        cwd: OUT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      console.log('go build OK', out);
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message: string };
      console.error('go build FAILED:\n', err.stderr ?? err.message);
      throw e;
    }
  });

  it('Java: java runs', () => {
    try {
      const out = execSync(`java -cp "${OUT}" Simulation`, {
        encoding: 'utf8',
        timeout: 30000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      console.log('Java run output:\n', out);
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message: string };
      console.error('java run FAILED:\n', err.stderr ?? err.message);
      throw e;
    }
  });

  it('Go: sim runs', () => {
    try {
      // `go run` builds + executes in one shot — avoids the Windows path
      // quoting mess that plain execFile of the built binary runs into.
      const out = execSync(`go run sim.go`, {
        cwd: OUT,
        encoding: 'utf8',
        timeout: 30000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      console.log('Go run output:\n', out);
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message: string };
      console.error('go run FAILED:\n', err.stderr ?? err.message);
      throw e;
    }
  });
});

afterAll(() => {
  try {
    rmSync(OUT, { recursive: true });
  } catch {
    // Best-effort cleanup of the temp directory; ignore if it never got
    // created (e.g. tests bailed out before running).
  }
});

