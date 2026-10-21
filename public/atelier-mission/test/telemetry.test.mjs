import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {test} from 'node:test';
import {parseNvidiaSmi, parseRocmSmi, parseXpuSmi, readDrmGpus, readGpus} from '../telemetry.mjs';

test('NVIDIA CSV readings preserve unavailable values', () => {
  assert.deepEqual(parseNvidiaSmi('0, GeForce Test, 22, 512, 8192, [N/A], 77.5, 200'), [{
    index: 0, name: 'GeForce Test', util: 22, vramUsedMiB: 512, vramTotalMiB: 8192,
    tempC: null, powerW: 77.5, powerLimitW: 200,
  }]);
});

test('Intel sysfs provides memory, temperature, power and a sampled busy percentage', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mission-telemetry-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const device = join(dir, 'card0', 'device');
  const write = async (name, value) => {
    const path = join(device, name);
    await mkdir(join(path, '..'), {recursive: true});
    await writeFile(path, String(value));
  };
  await mkdir(device, {recursive: true});
  await write('vendor', '0x8086');
  await write('product_name', 'Intel Test Adapter');
  await write('mem_info_vram_used', 524288000);
  await write('mem_info_vram_total', 2147483648);
  await write('gt/gt0/rcs0/busy', 1000000000);
  await write('hwmon/hwmon0/temp1_input', 51000);
  await write('hwmon/hwmon0/power1_average', 42000000);
  assert.equal((await readDrmGpus({root: dir, now: 1000}))[0].util, null);
  await write('gt/gt0/rcs0/busy', 1500000000);
  const [gpu] = await readDrmGpus({root: dir, now: 2000});
  assert.deepEqual([gpu.name, gpu.util, gpu.vramUsedMiB, gpu.vramTotalMiB, gpu.tempC, gpu.powerW],
    ['Intel Test Adapter', 50, 500, 2048, 51, 42]);
});

test('AMD sysfs and vendor JSON parsers return common readings', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mission-telemetry-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const device = join(dir, 'card1', 'device');
  await mkdir(join(device, 'hwmon', 'hwmon0'), {recursive: true});
  for (const [name, value] of Object.entries({vendor: '0x1002', product_name: 'AMD Test Adapter', gpu_busy_percent: 31,
    mem_info_vram_used: 1048576, mem_info_vram_total: 8388608, 'hwmon/hwmon0/temp1_input': 46000,
    'hwmon/hwmon0/power1_average': 25000000})) {
    const path = join(device, name);
    await mkdir(join(path, '..'), {recursive: true});
    await writeFile(path, String(value));
  }
  const [gpu] = await readDrmGpus({root: dir});
  assert.deepEqual([gpu.util, gpu.vramUsedMiB, gpu.vramTotalMiB, gpu.tempC, gpu.powerW], [31, 1, 8, 46, 25]);
  assert.equal(parseXpuSmi(JSON.stringify({device_list: [{device_id: 1, device_name: 'Intel Test', gpu_utilization: 8, gpu_power: 44, gpu_core_temperature: 50, gpu_memory_used: 120}]}))[0].powerW, 44);
  assert.equal(parseXpuSmi(JSON.stringify({device_id: 0, device_level: [
    {metrics_type: 'XPUM_STATS_POWER', value: 14.27}, {metrics_type: 'XPUM_STATS_MEMORY_USED', value: 16},
  ]}))[0].powerW, 14.27);
  const amd = parseRocmSmi(JSON.stringify({card0: {'GPU use (%)': '19', 'Average Graphics Package Power (W)': '80',
    'VRAM Total Used Memory (B)': '1073741824', 'VRAM Total Memory (B)': '8589934592'}}))[0];
  assert.deepEqual([amd.util, amd.vramUsedMiB, amd.vramTotalMiB, amd.powerW], [19, 1024, 8192, 80]);
});

test('GPU-less systems report no GPU data instead of fabricated readings', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mission-telemetry-empty-'));
  try {
    const result = await readGpus({exec: async () => null, root: dir});
    assert.equal(result.ok, false);
    assert.deepEqual(result.gpus, []);
  } finally { await rm(dir, {recursive: true, force: true}); }
});
