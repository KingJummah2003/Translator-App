Pod::Spec.new do |s|
  s.name           = 'TranslatorNative'
  s.version        = '1.0.0'
  s.summary        = 'On-device translation, language ID and text recognition'
  s.author         = ''
  s.homepage       = 'https://github.com/KingJummah2003/Translator-App'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '16.4' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  # ML Kit has no arm64 simulator slice. with-mlkit-simulator.js limits linking of these
  # frameworks to device builds, and the Swift code compiles them out in the simulator.
  s.dependency 'GoogleMLKit/Translate', '~> 9.0'
  s.dependency 'GoogleMLKit/LanguageID', '~> 9.0'

  s.source_files = '**/*.swift'
end
