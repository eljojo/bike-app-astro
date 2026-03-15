import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { outputSize, parseProbeOutput, buildJobDefinition, thumbSize } from './handler.mjs';

// --- outputSize tests ---

describe('outputSize', () => {
  it('scales 4K landscape to 1920x1080', () => {
    const result = outputSize(3840, 2160);
    assert.deepStrictEqual(result, { width: 1920, height: 1080 });
  });

  it('scales 4K portrait to 1080x1920', () => {
    const result = outputSize(2160, 3840);
    assert.deepStrictEqual(result, { width: 1080, height: 1920 });
  });

  it('leaves 1080p unchanged', () => {
    const result = outputSize(1920, 1080);
    assert.deepStrictEqual(result, { width: 1920, height: 1080 });
  });

  it('leaves small videos unchanged', () => {
    const result = outputSize(1280, 720);
    assert.deepStrictEqual(result, { width: 1280, height: 720 });
  });

  it('rounds to even dimensions', () => {
    const result = outputSize(3841, 2161);
    assert.equal(result.width % 2, 0);
    assert.equal(result.height % 2, 0);
  });

  it('handles ultra-wide video', () => {
    // 2560x800 — long edge hits 1920 limit
    const result = outputSize(2560, 800);
    assert.equal(result.width, 1920);
    assert.equal(result.height, 600);
  });
});

// --- parseProbeOutput tests ---

describe('parseProbeOutput', () => {
  it('extracts dimensions from video stream', () => {
    const probeData = {
      streams: [
        { codec_type: 'audio', sample_rate: '48000' },
        { codec_type: 'video', width: 1920, height: 1080 },
      ],
      format: { duration: '120.5' },
    };
    const result = parseProbeOutput(probeData);
    assert.equal(result.width, 1920);
    assert.equal(result.height, 1080);
    assert.equal(result.duration, 120.5);
    assert.equal(result.orientation, 'landscape');
  });

  it('handles portrait video via side_data rotation', () => {
    const probeData = {
      streams: [{
        codec_type: 'video',
        width: 1920,
        height: 1080,
        side_data_list: [{ rotation: -90 }],
      }],
      format: { duration: '30' },
    };
    const result = parseProbeOutput(probeData);
    assert.equal(result.width, 1080);
    assert.equal(result.height, 1920);
    assert.equal(result.orientation, 'portrait');
    assert.equal(result.rotation, 90);
  });

  it('handles portrait video via tags.rotate', () => {
    const probeData = {
      streams: [{
        codec_type: 'video',
        width: 1920,
        height: 1080,
        tags: { rotate: '270' },
      }],
      format: { duration: '10' },
    };
    const result = parseProbeOutput(probeData);
    assert.equal(result.width, 1080);
    assert.equal(result.height, 1920);
    assert.equal(result.orientation, 'portrait');
  });

  it('extracts capture date from format tags', () => {
    const probeData = {
      streams: [{ codec_type: 'video', width: 1280, height: 720 }],
      format: {
        duration: '60',
        tags: { creation_time: '2025-06-15T14:30:00.000000Z' },
      },
    };
    const result = parseProbeOutput(probeData);
    assert.equal(result.capturedAt, '2025-06-15T14:30:00.000000Z');
  });

  it('parses GPS from ISO 6709 location tag', () => {
    const probeData = {
      streams: [{ codec_type: 'video', width: 1280, height: 720 }],
      format: {
        duration: '60',
        tags: { location: '+48.8566+002.3522+035.000/' },
      },
    };
    const result = parseProbeOutput(probeData);
    assert.deepStrictEqual(result.gps, { lat: 48.8566, lng: 2.3522 });
  });

  it('throws when no video stream found', () => {
    const probeData = {
      streams: [{ codec_type: 'audio' }],
      format: {},
    };
    assert.throws(() => parseProbeOutput(probeData), /No video stream found/);
  });

  it('handles missing duration gracefully', () => {
    const probeData = {
      streams: [{ codec_type: 'video', width: 640, height: 480 }],
      format: {},
    };
    const result = parseProbeOutput(probeData);
    assert.equal(result.duration, 0);
  });
});

// --- buildJobDefinition tests ---

describe('buildJobDefinition', () => {
  // Set env vars for job definition
  beforeEach(() => {
    process.env.S3_ORIGINALS_BUCKET = 'test-originals';
    process.env.S3_OUTPUTS_BUCKET = 'test-outputs';
    process.env.MEDIACONVERT_QUEUE = 'test-queue';
    process.env.MEDIACONVERT_ROLE = 'test-role';
  });

  it('creates job with correct input/output paths', () => {
    const job = buildJobDefinition('ottawa/abc12345', { width: 1920, height: 1080, duration: 60 });
    const input = job.Settings.Inputs[0];
    assert.equal(input.FileInput, 's3://test-originals/ottawa/abc12345');

    const mp4Group = job.Settings.OutputGroups[0];
    assert.equal(
      mp4Group.OutputGroupSettings.FileGroupSettings.Destination,
      's3://test-outputs/ottawa/abc12345/',
    );
  });

  it('scales 4K to 1080p in output', () => {
    const job = buildJobDefinition('ottawa/abc12345', { width: 3840, height: 2160, duration: 60 });
    const h264Output = job.Settings.OutputGroups[0].Outputs[0];
    assert.equal(h264Output.VideoDescription.Width, 1920);
    assert.equal(h264Output.VideoDescription.Height, 1080);
  });

  it('has MP4, HLS, and poster output groups', () => {
    const job = buildJobDefinition('ottawa/abc12345', { width: 1920, height: 1080, duration: 60 });
    const groups = job.Settings.OutputGroups;
    assert.equal(groups.length, 3);
    assert.equal(groups[0].CustomName, 'mp4');
    assert.equal(groups[1].CustomName, 'hls');
    assert.equal(groups[2].CustomName, 'poster');
  });

  it('has single H.264 MP4 output', () => {
    const job = buildJobDefinition('ottawa/abc12345', { width: 1920, height: 1080, duration: 60 });
    const mp4Outputs = job.Settings.OutputGroups[0].Outputs;
    assert.equal(mp4Outputs.length, 1);
    assert.equal(mp4Outputs[0].NameModifier, '-h264');
    assert.equal(mp4Outputs[0].VideoDescription.CodecSettings.Codec, 'H_264');
  });

  it('HLS variants both use H.265', () => {
    const job = buildJobDefinition('ottawa/abc12345', { width: 1920, height: 1080, duration: 60 });
    const hlsOutputs = job.Settings.OutputGroups[1].Outputs;
    assert.equal(hlsOutputs[0].VideoDescription.CodecSettings.Codec, 'H_265');
    assert.equal(hlsOutputs[1].VideoDescription.CodecSettings.Codec, 'H_265');
  });

  it('has HLS thumb and big outputs', () => {
    const job = buildJobDefinition('ottawa/abc12345', { width: 1920, height: 1080, duration: 60 });
    const hlsOutputs = job.Settings.OutputGroups[1].Outputs;
    assert.equal(hlsOutputs.length, 2);
    assert.equal(hlsOutputs[0].NameModifier, '-thumb');
    assert.equal(hlsOutputs[1].NameModifier, '-big');
  });

  it('HLS thumb uses smaller resolution', () => {
    const job = buildJobDefinition('ottawa/abc12345', { width: 3840, height: 2160, duration: 60 });
    const thumbOutput = job.Settings.OutputGroups[1].Outputs[0];
    assert.equal(thumbOutput.VideoDescription.Width, 640);
    assert.equal(thumbOutput.VideoDescription.Height, 360);
  });

  it('sets queue and role from env', () => {
    const job = buildJobDefinition('ottawa/abc12345', { width: 1920, height: 1080, duration: 60 });
    assert.equal(job.Queue, 'test-queue');
    assert.equal(job.Role, 'test-role');
  });

  it('sets UserMetadata with prefix and videoKey', () => {
    const job = buildJobDefinition('ottawa-staging/testkey5', { width: 1920, height: 1080, duration: 60 });
    assert.deepStrictEqual(job.UserMetadata, { prefix: 'ottawa-staging', videoKey: 'testkey5' });
  });

  it('uses correct output group types', () => {
    const job = buildJobDefinition('ottawa/abc12345', { width: 1920, height: 1080, duration: 60 });
    assert.equal(job.Settings.OutputGroups[0].OutputGroupSettings.Type, 'FILE_GROUP_SETTINGS');
    assert.equal(job.Settings.OutputGroups[1].OutputGroupSettings.Type, 'HLS_GROUP_SETTINGS');
    assert.equal(job.Settings.OutputGroups[2].OutputGroupSettings.Type, 'FILE_GROUP_SETTINGS');
  });

  it('clips input to 3 minutes when video exceeds limit', () => {
    const job = buildJobDefinition('ottawa/abc12345', { width: 1920, height: 1080, duration: 300 });
    const clippings = job.Settings.Inputs[0].InputClippings;
    assert.deepStrictEqual(clippings, [{ EndTimecode: '00:03:00:00' }]);
  });

  it('does not clip input when video is under 3 minutes', () => {
    const job = buildJobDefinition('ottawa/abc12345', { width: 1920, height: 1080, duration: 60 });
    assert.equal(job.Settings.Inputs[0].InputClippings, undefined);
  });
});
