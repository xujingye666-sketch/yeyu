import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
}

val localProperties = Properties().apply {
    val localFile = rootProject.file("local.properties")
    if (localFile.isFile) {
        localFile.reader(Charsets.UTF_8).use(::load)
    }
}

val signingStorePath = localProperties.getProperty("yeyu.signing.storeFile")
val signingStorePassword = localProperties.getProperty("yeyu.signing.storePassword")
val signingKeyAlias = localProperties.getProperty("yeyu.signing.keyAlias")
val signingKeyPassword = localProperties.getProperty("yeyu.signing.keyPassword")
val hasOriginalSigning = listOf(
    signingStorePath,
    signingStorePassword,
    signingKeyAlias,
    signingKeyPassword
).all { !it.isNullOrBlank() }

android {
    namespace = "com.yeyu.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.yeyu.app"
        minSdk = 33
        targetSdk = 35
        versionCode = 334
        versionName = "1.0.0"
    }

    signingConfigs {
        if (hasOriginalSigning) {
            create("original") {
                storeFile = file(requireNotNull(signingStorePath))
                storePassword = requireNotNull(signingStorePassword)
                keyAlias = requireNotNull(signingKeyAlias)
                keyPassword = requireNotNull(signingKeyPassword)
            }
        }
    }

    buildTypes {
        release {
            if (hasOriginalSigning) {
                signingConfig = signingConfigs.getByName("original")
            }
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
tasks.configureEach {
    if (name == "packageRelease") {
        check(hasOriginalSigning) {
            "Original Yeyu signing settings are missing from local.properties."
        }
    }
}
