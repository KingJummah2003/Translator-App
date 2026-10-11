// Google ML Kit ships its iOS frameworks without an arm64 *simulator* slice, so an app that
// links them cannot build for the Simulator on Apple-silicon Macs. This plugin keeps the
// ML Kit frameworks in the link step for device builds only. The Swift code in
// modules/translator-native compiles ML Kit out in the Simulator, where the app falls
// back to cloud translation.
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = '# [translator] ML Kit device-only linking';

const SNIPPET = String.raw`
  ${MARKER}
  post_integrate do |installer|
    Dir.glob(File.join(installer.sandbox.root, 'Target Support Files', '*', '*.xcconfig')).each do |file|
      text = File.read(file)
      original = text.dup
      # ML Kit pods exclude arm64 from Simulator builds, which makes the app unbuildable
      # on Apple-silicon Simulators. We compile ML Kit out there instead.
      text = text.gsub(/^EXCLUDED_ARCHS\[sdk=iphonesimulator\*\] = arm64\n/, '')
      line = text[/^OTHER_LDFLAGS = .*$/]
      if line && line =~ /-framework "(MLKit|MLImage)/
        simulator = line.gsub(/ -framework "(MLKit|MLImage)[^"]*"/, '')
        device = line.sub('OTHER_LDFLAGS = ', 'OTHER_LDFLAGS[sdk=iphoneos*] = ')
        text = text.sub(line, "#{simulator}\n#{device}")
      end
      File.write(file, text) if text != original
    end
  end
`;

module.exports = function withMlkitSimulator(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfile, 'utf8');
      if (!contents.includes(MARKER)) {
        // Insert just before the final `end` of the main target block.
        const idx = contents.lastIndexOf('\nend');
        contents = contents.slice(0, idx) + '\n' + SNIPPET + contents.slice(idx);
        fs.writeFileSync(podfile, contents);
      }
      return cfg;
    },
  ]);
};
