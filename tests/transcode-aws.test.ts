import { describe, it, expect } from 'vitest';
import { buildJobDefinition } from '../src/lib/transcode-aws';

const config = {
  queue: 'arn:aws:queue',
  role: 'arn:aws:role',
  originsBucket: 'originals',
  outputsBucket: 'outputs',
};

describe('buildJobDefinition', () => {
  it('includes AV1 and H.264 MP4 outputs', () => {
    const job = buildJobDefinition({ key: 'testkey', width: 3840, height: 2160 }, config);
    const outputs = job.Settings.OutputGroups[0].Outputs;
    expect(outputs).toHaveLength(2);
    expect(outputs[0].NameModifier).toBe('-av1');
    expect(outputs[1].NameModifier).toBe('-h264');
  });

  it('includes frame capture output group', () => {
    const job = buildJobDefinition({ key: 'testkey', width: 1920, height: 1080 }, config);
    const groups = job.Settings.OutputGroups;
    const frameCapture = groups.find((g) => g.CustomName === 'poster');
    expect(frameCapture).toBeDefined();
  });

  it('uses 12 Mbps for AV1', () => {
    const job = buildJobDefinition({ key: 'testkey', width: 1920, height: 1080 }, config);
    const av1Output = job.Settings.OutputGroups[0].Outputs[0];
    expect((av1Output.VideoDescription.CodecSettings as any).av_1_settings.MaxBitrate).toBe(12_000_000);
  });

  it('uses 10 Mbps for H.264', () => {
    const job = buildJobDefinition({ key: 'testkey', width: 1920, height: 1080 }, config);
    const h264Output = job.Settings.OutputGroups[0].Outputs[1];
    expect((h264Output.VideoDescription.CodecSettings as any).H264Settings.MaxBitrate).toBe(10_000_000);
  });

  it('sets input path from key', () => {
    const job = buildJobDefinition({ key: 'abc123', width: 1920, height: 1080 }, config);
    expect(job.Settings.Inputs[0].FileInput).toBe('s3://originals/abc123');
  });

  it('sets output destination from key', () => {
    const job = buildJobDefinition({ key: 'abc123', width: 1920, height: 1080 }, config);
    expect(job.Settings.OutputGroups[0].OutputGroupSettings.FileGroupSettings.Destination)
      .toBe('s3://outputs/abc123/');
  });

  it('scales dimensions with outputSize', () => {
    const job = buildJobDefinition({ key: 'testkey', width: 3840, height: 2160 }, config);
    const av1 = job.Settings.OutputGroups[0].Outputs[0];
    expect(av1.VideoDescription.Width).toBe(1080);
    expect(av1.VideoDescription.Height).toBe(608);
  });
});
